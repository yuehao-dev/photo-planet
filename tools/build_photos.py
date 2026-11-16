#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_photos.py —— 照片清单生成器（本地预览阶段）

它只做三件事：
  1. 扫描 --src 指定的本地照片目录
  2. 生成 WebP 派生图：thumb（网格用，宽 880）/ full（灯箱用，宽 1500）
  3. 输出「图片配置层」 data/photos.js 与 data/photos.json

页面只依赖配置层里的 thumbUrl / fullUrl，永远不关心图片存在哪里。
将来迁移到 OSS 时，在 config/site.js 指定媒体域名，
页面仍通过配置解析资源路径，原图路径不会写进发布包。

依赖：Pillow、PATH 中的 ffmpeg / ffprobe

用法：
  python tools/build_photos.py --src ../private/photos # 全量：转图 + 生成清单
  python tools/build_photos.py --src ../private/photos --manifest-only     # 只重建清单（不重新转图）
  python tools/build_photos.py --src ../private/photos --metadata "备份.json" # 应用标签 / 日期补记
  python tools/build_photos.py --src "../private/photos"
"""

from __future__ import annotations

import argparse
from photo_config import load_config as load_photo_config, validate_settings as validate_photo_settings
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------- 默认配置
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = None
DEFAULT_OUT = PROJECT_ROOT / "public" / "photos"
MANIFEST_JS = PROJECT_ROOT / "data" / "photos.js"
MANIFEST_JSON = PROJECT_ROOT / "data" / "photos.json"
TAGS_FILE = PROJECT_ROOT / "data" / "tags.json"

# 默认派生图尺寸与画质见 photo_config.py，可通过 --config 调整。

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic", ".avif"}

SEASONS = {
    1: "冬天", 2: "冬天", 3: "春天", 4: "春天", 5: "春天",
    6: "夏天", 7: "夏天", 8: "夏天", 9: "秋天", 10: "秋天",
    11: "秋天", 12: "冬天",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def which_ffmpeg() -> tuple[str, str]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        sys.exit("[x] 找不到 ffmpeg / ffprobe，请先安装并加入 PATH。")
    return ffmpeg, ffprobe


def sha1_of(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe_size(ffprobe: str, path: Path) -> tuple[int, int]:
    out = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    w, h = out.split(",")[:2]
    return int(w), int(h)


# ---------------------------------------------------------------- EXIF 解析
# 这些 jpg 是微信保存的，ffprobe 读不到 format_tags=creation_time，
# 所以拍摄时间只能自己从 JPEG 的 APP1 段里解析。不引入 Pillow：
# EXIF 就是「TIFF 头 + 若干 IFD」，用 struct 解析足够了。

EXIF_SCAN_BYTES = 400_000   # APP1 一定在文件头部，只读前 400KB
# 各字段类型的单值字节数：1 BYTE / 2 ASCII / 3 SHORT / 4 LONG / 5 RATIONAL / 7 UNDEFINED / 9 SLONG / 10 SRATIONAL
TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}
TAG_EXIF_IFD = 0x8769           # IFD0 里指向 Exif 子 IFD 的指针
TAG_GPS_IFD = 0x8825            # IFD0 里指向 GPS 子 IFD 的指针
TAG_DATETIME_ORIGINAL = 0x9003  # Exif 子 IFD 里的「原始拍摄时间」


def read_exif_tiff(path: Path) -> bytes | None:
    """在 APP1 段里取出 TIFF 数据块（跳过 "Exif\\0\\0" 这 6 个字节），读不到返回 None。"""
    with path.open('rb') as stream:
        data = stream.read(EXIF_SCAN_BYTES)
    if data[:2] != b"\xff\xd8":          # 不是 JPEG（SOI 标记）
        return None
    i = 2
    while i < len(data) - 4:
        if data[i] != 0xFF:              # 段结构断了，放弃
            return None
        size = struct.unpack(">H", data[i + 2:i + 4])[0]   # 段长度含自身 2 字节
        if data[i + 4:i + 10] == b"Exif\x00\x00":
            return data[i + 10:i + 2 + size]
        i += 2 + size
    return None


def parse_ifd(tiff: bytes, offset: int, endian: str) -> dict[int, tuple[int, int, bytes]]:
    """解析一个 IFD，返回 {tag: (type, count, 原始值字节)}。

    每条目 12 字节：tag(H) type(H) count(I) value(4B)。
    值本身不超过 4 字节时，value 就是值（左对齐）；
    超过 4 字节时，value 是「偏移量」，必须按偏移回 TIFF 块里取——
    ASCII 字符串 count>4 就属于这种情况，最容易在这里写错。
    """
    out: dict[int, tuple[int, int, bytes]] = {}
    if offset <= 0 or offset + 2 > len(tiff):
        return out
    count = struct.unpack(endian + "H", tiff[offset:offset + 2])[0]
    for n in range(count):
        e = offset + 2 + n * 12
        if e + 12 > len(tiff):
            break
        tag, typ, cnt = struct.unpack(endian + "HHI", tiff[e:e + 8])
        need = TYPE_SIZE.get(typ, 1) * cnt
        if need <= 4:
            raw = tiff[e + 8:e + 8 + need]
        else:
            at = struct.unpack(endian + "I", tiff[e + 8:e + 12])[0]
            if at + need > len(tiff):
                continue
            raw = tiff[at:at + need]
        out[tag] = (typ, cnt, raw)
    return out


def _ascii_value(entry: tuple[int, int, bytes] | None) -> str:
    """ASCII 类型以 NUL 结尾，去掉尾部填充再解码。"""
    if not entry:
        return ""
    return entry[2].split(b"\x00", 1)[0].decode("ascii", "ignore").strip()


def _int_value(entry: tuple[int, int, bytes] | None, endian: str) -> int:
    """取 SHORT / LONG 型单值（用于 IFD 指针）。"""
    if not entry:
        return 0
    typ, _cnt, raw = entry
    if typ == 3 and len(raw) >= 2:
        return struct.unpack(endian + "H", raw[:2])[0]
    if typ in (4, 9) and len(raw) >= 4:
        return struct.unpack(endian + "I", raw[:4])[0]
    return 0


def _rationals(raw: bytes, endian: str, count: int) -> list[float]:
    """RATIONAL 是「分子/分母」两个 LONG，分母为 0 时按 0 处理。"""
    vals = []
    for n in range(count):
        num, den = struct.unpack(endian + "II", raw[n * 8:n * 8 + 8])
        vals.append(num / den if den else 0.0)
    return vals


def _gps_coord(value_entry, ref_entry, endian: str) -> float | None:
    """GPS 坐标：3 个 RATIONAL 表示度/分/秒，参考方位 S/W 取负。"""
    if not value_entry or value_entry[1] < 3 or len(value_entry[2]) < 24:
        return None
    d, m, s = _rationals(value_entry[2], endian, 3)
    if not (d or m or s):               # 全 0 视为没有定位数据
        return None
    deg = d + m / 60 + s / 3600
    return -deg if _ascii_value(ref_entry).upper() in ("S", "W") else deg


def read_exif(path: Path) -> dict:
    """读一张 jpg 的拍摄时间与 GPS，返回 {"taken": datetime|None, "gps": [lat, lon]|None}。

    流程：APP1 → TIFF 头（II/MM 两种字节序）→ IFD0
          → 0x8769 ExifIFD → 0x9003 DateTimeOriginal（"YYYY:MM:DD HH:MM:SS"）
          → 0x8825 GPSIFD → tag2 纬度 / tag4 经度
    """
    info: dict = {"taken": None, "gps": None}
    tiff = read_exif_tiff(path)
    if not tiff or len(tiff) < 8:
        return info
    endian = {b"II": "<", b"MM": ">"}.get(tiff[:2])   # II 小端 / MM 大端
    if endian is None or struct.unpack(endian + "H", tiff[2:4])[0] != 42:
        return info                                   # 魔数不是 42，不是合法 TIFF
    ifd0 = parse_ifd(tiff, struct.unpack(endian + "I", tiff[4:8])[0], endian)

    # 拍摄时间：IFD0 只存子 IFD 的偏移，真正的 0x9003 在 ExifIFD 里
    exif_off = _int_value(ifd0.get(TAG_EXIF_IFD), endian)
    if exif_off:
        raw_dt = _ascii_value(parse_ifd(tiff, exif_off, endian).get(TAG_DATETIME_ORIGINAL))
        if raw_dt:
            try:
                info["taken"] = datetime.strptime(raw_dt, "%Y:%m:%d %H:%M:%S")
            except ValueError:
                pass                                  # "0000:00:00 00:00:00" 之类的空值

    # GPS：大部分照片没有，读不到就保持 None，不补默认值
    gps_off = _int_value(ifd0.get(TAG_GPS_IFD), endian)
    if gps_off:
        gps = parse_ifd(tiff, gps_off, endian)
        lat = _gps_coord(gps.get(2), gps.get(1), endian)   # 2=纬度 1=北/南
        lon = _gps_coord(gps.get(4), gps.get(3), endian)   # 4=经度 3=东/西
        if lat is not None and lon is not None:
            info["gps"] = [round(lat, 6), round(lon, 6)]
    return info


def guess_taken_at(path: Path, exif_taken: datetime | None = None, root: Path | None = None) -> tuple[datetime | None, str]:
    """只认原始拍摄时间或明确归档的日期目录；微信导出/修改时间均不使用。"""
    if exif_taken:
        return exif_taken, "exif"
    try:
        with Image.open(path) as image:
            exif = image.getexif()
            raw = exif.get_ifd(0x8769).get(0x9003) or exif.get(0x9003)
            if raw:
                return datetime.strptime(str(raw).strip().strip("\x00"), "%Y:%m:%d %H:%M:%S"), "exif"
    except (OSError, ValueError, TypeError, SyntaxError):
        pass
    parents = path.relative_to(root).parts[:-1] if root else (path.parent.name,)
    if "拍摄时间未知" in parents:
        return None, "unknown"
    for name in reversed(parents):
        if re.fullmatch(r"[12]\d{3}-\d{2}-\d{2}", name):
            try:
                return datetime.strptime(name, "%Y-%m-%d"), "folder"
            except ValueError:
                pass
    return None, "unknown"


def convert(ffmpeg: str, src: Path, dst: Path, width: int, quality: int) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, "-v", "error", "-y", "-i", str(src),
        "-vf", f"scale='min({width},iw)':-2:flags=lanczos",
        "-c:v", "libwebp", "-q:v", str(quality), "-compression_level", "5",
        "-map_metadata", "-1", "-frames:v", "1", str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        log(f"    [!] 转换失败 {src.name}: {r.stderr.strip()[:160]}")
        return False
    return True


def load_curated_tags() -> dict[str, list[str]]:
    if not TAGS_FILE.exists():
        return {}
    try:
        raw = json.loads(TAGS_FILE.read_text(encoding="utf-8"))
        return {k: v for k, v in raw.items() if isinstance(v, list) and not k.startswith("_")}
    except Exception as e:
        log(f"[!] data/tags.json 解析失败，已忽略：{e}")
        return {}


def collect(src: Path) -> list[Path]:
    # 原目录只读；不把筛选记录、隐藏目录中的辅助图加入相册。
    return sorted((p for p in src.rglob("*") if p.is_file() and p.suffix.lower() in EXTS
                   and not any(part.startswith(("_", ".")) for part in p.relative_to(src).parts)),
                  key=lambda p: p.relative_to(src).as_posix())


def stable_ids(files: list[Path], previous: list[dict], src: Path, hashes: dict) -> dict[str, str]:
    """优先复用内容一致的旧 ID；新 ID 基于内容，移动子目录/改名不丢收藏。"""
    existing = {p.get("contentHash"): p["id"] for p in previous if p.get("contentHash")}
    by_name = {}
    for p in previous:
        by_name.setdefault(Path(p.get("file", "")).name, []).append(p)
    used = set()
    result = {}
    for f in files:
        digest = hashes[f]
        candidate = existing.get(digest)
        if not candidate:
            choices = by_name.get(f.name, [])
            if len(choices) == 1 and choices[0].get("thumbUrl", "").endswith("-" + digest[:8] + ".webp"):
                candidate = choices[0]["id"]
        if not candidate or candidate in used:
            candidate = "p_" + digest[:20]
            if candidate in used:  # 同内容文件也保留，不擅自删减用户已经精选的目录。
                candidate += "_" + hashlib.sha256(f.relative_to(src).as_posix().encode()).hexdigest()[:10]
        used.add(candidate)
        result[f.relative_to(src).as_posix()] = candidate
    return result


def validate_memory(value: dict) -> dict:
    if not isinstance(value, dict) or "takenAt" not in value:
        raise ValueError("日期备份格式不正确")
    taken = value["takenAt"]
    if taken is not None:
        if not isinstance(taken, str) or not re.fullmatch(r"[12]\d{3}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2})?)?)?", taken):
            raise ValueError("日期应为 YYYY / YYYY-MM / YYYY-MM-DD / ISO 本地时间或 null")
        datetime.strptime(taken, {4: "%Y", 7: "%Y-%m", 10: "%Y-%m-%d", 19: "%Y-%m-%dT%H:%M:%S"}[len(taken)])
    season = value.get("season")
    if season not in (None, "spring", "summer", "autumn", "winter"):
        raise ValueError("季节不正确")
    if taken and len(taken) >= 7:
        season = ("winter", "spring", "summer", "autumn")[(int(taken[5:7]) % 12) // 3]
    return {"takenAt": taken, "season": season}


def main() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, help="Private photo recipe JSON; source is relative to config")
    ap.add_argument("--src", help="Read-only source image directory")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--manifest-only", action="store_true", help="只重建清单；缺派生图则报错，保留旧清单")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--metadata", type=Path, help="导入网页导出的标签/日期备份，写入全设备共用清单")
    args = ap.parse_args()
    if not (PROJECT_ROOT / '.private-mode').exists():
        ap.error('Run python tools/prepare_private.py --confirm before importing private data.')
    try:
        recipe = load_photo_config(args.config) if args.config else validate_photo_settings({'version': 1})
    except (OSError, ValueError) as error:
        ap.error(str(error))
    source_path = args.src or recipe.get('source')
    if not source_path:
        ap.error('Provide --src or source in --config.')
    src, out = Path(source_path).resolve(), Path(args.out).resolve()
    if not src.is_dir():
        sys.exit(f"[x] 照片目录不存在：{src}")
    if out == src or src in out.parents or not out.is_relative_to((PROJECT_ROOT / 'public').resolve()):
        sys.exit("[x] 派生图输出仅允许网站 public 内的子目录，不能覆盖源目录")
    ffmpeg, _ = which_ffmpeg()
    files = collect(src)
    if args.limit:
        files = files[:args.limit]
    if not files:
        sys.exit("[x] 未找到图片，旧清单保持不变")
    log(f"[i] 递归读取（原图只读）：{src}，{len(files)} 张")
    curated = load_curated_tags()
    previous = json.loads(MANIFEST_JSON.read_text(encoding='utf-8')).get('photos', []) if MANIFEST_JSON.exists() else []
    hashes = {f: sha1_of(f) for f in files}
    identities = stable_ids(files, previous, src, hashes)
    old_by_id = {p['id']: p for p in previous}
    backup = json.loads(args.metadata.read_text(encoding='utf-8-sig')) if args.metadata else {}
    if backup and (backup.get('version') not in (1, 2, 3) or not isinstance(backup.get('photos'), dict)):
        sys.exit('[x] 请使用网页导出的标签/日期备份')
    memories = {key: validate_memory(value) for key, value in backup.get('memories', {}).items()}
    chat_links = backup.get('chatLinks', {})
    if not isinstance(chat_links, dict):
        sys.exit('[x] 聊天日期搭配格式不正确')
    for date in chat_links.values():
        if date is not None:
            if not isinstance(date, str) or not re.fullmatch(r'[12]\d{3}-\d{2}-\d{2}', date):
                sys.exit('[x] 聊天日期需要完整的 YYYY-MM-DD')
            datetime.strptime(date, '%Y-%m-%d')
    for tags in backup.get('photos', {}).values():
        if not isinstance(tags, list) or len(tags) > 12 or any(not isinstance(t, str) or not 1 <= len(t) <= 20 for t in tags):
            sys.exit('[x] 备份标签格式不正确')
    season_names = dict(zip(('spring','summer','autumn','winter'), ('春天','夏天','秋天','冬天')))
    reserved = set(season_names.values()) | {'本机'}

    def process(f):
        relative = f.relative_to(src).as_posix()
        photo_id = identities[relative]
        exif = read_exif(f)
        taken, source = guess_taken_at(f, exif['taken'], src)
        iso = taken.strftime('%Y-%m-%dT%H:%M:%S') if taken else None
        if source == 'folder':
            iso = iso[:10]
        memory = memories.get(photo_id)
        old = old_by_id.get(photo_id, {})
        if memory is None and old.get('dateSource') == 'manual':
            memory = {'takenAt': old['takenAt'], 'season': old.get('season')}
        season = next((s for s, label in season_names.items() if taken and label == SEASONS[taken.month]), None)
        if memory is not None:
            iso, season, source = memory['takenAt'], memory['season'], 'manual'
        recipe_hash = hashlib.sha1((hashes[f] + json.dumps({k: recipe[k] for k in ['thumbWidth', 'fullWidth', 'quality']}, sort_keys=True)).encode()).hexdigest()[:8]
        stem = f"{photo_id}-{recipe_hash}"
        thumb, full = out / 'thumb' / (stem + '.webp'), out / 'full' / (stem + '.webp')
        for dest, width, quality in [(thumb, recipe['thumbWidth'], recipe['quality']), (full, recipe['fullWidth'], recipe['quality'] + 2)]:
            if not dest.exists():
                if args.manifest_only or not convert(ffmpeg, f, dest, width, quality):
                    raise RuntimeError(f"缺少派生图或转换失败：{relative}")
        with Image.open(thumb) as image:
            w, h = image.size
        tags = [t for t in old.get('tags', []) if t not in reserved]
        tags = curated.get(relative, curated.get(f.name, tags))
        tags = backup.get('photos', {}).get(photo_id, tags)
        return {
            'id': photo_id, 'file': relative, 'contentHash': hashes[f],
            'thumbUrl': thumb.relative_to(PROJECT_ROOT).as_posix(),
            'fullUrl': full.relative_to(PROJECT_ROOT).as_posix(),
            'width': w, 'height': h, 'ratio': round(w/h, 4),
            'orientation': 'landscape' if w > h*1.05 else ('portrait' if h > w*1.05 else 'square'),
            'takenAt': iso, 'dateSource': source,
            'datePrecision': 'unknown' if not iso else ('year' if len(iso)==4 else 'month' if len(iso)==7 else 'day'),
            'season': season,
            'chatDate': chat_links.get(photo_id, old.get('chatDate')),
            'tags': ([season_names[season]] if season else []) + list(dict.fromkeys(t for t in tags if t and t not in reserved)),
        }

    photos = []
    try:
        with ThreadPoolExecutor(max_workers=recipe['workers']) as pool:
            for i, photo in enumerate(pool.map(process, files), 1):
                photos.append(photo)
                if i % 25 == 0 or i == len(files): log(f'    … {i}/{len(files)}')
    except Exception as error:
        sys.exit(f'[x] {error}。旧清单保持不变；修复后重跑会复用已生成图片。')
    # 朋友圈导入单独持久化，重建原照片目录时继续保留。
    supplemental = PROJECT_ROOT / 'data/photos-moments.json'
    if supplemental.is_file():
        extra = json.loads(supplemental.read_text(encoding='utf-8')).get('photos', [])
        # 可选保留清单用于暂时缺少源文件、但仍有派生图的照片。
        retained_file = PROJECT_ROOT / 'data/photos-retained.json'
        retained = json.loads(retained_file.read_text(encoding='utf-8')).get('photos', []) if retained_file.is_file() else []
        retained_ids = {p['id'] for p in retained}
        extra.extend(retained)
        known_ids = {p['id'] for p in photos}
        known_hashes = {p.get('contentHash') for p in photos if p.get('contentHash')}
        for original in extra:
            if original['id'] in known_ids or original.get('contentHash') in known_hashes:
                continue
            photo = dict(original)
            if photo['id'] not in retained_ids and (not photo['id'].startswith('moments-') or photo.get('sourceType') != 'moments'):
                sys.exit('[x] 朋友圈补充清单来源不正确，旧清单保持不变')
            for field in ('thumbUrl', 'fullUrl'):
                derivative = (PROJECT_ROOT / photo[field]).resolve()
                if not derivative.is_relative_to(DEFAULT_OUT.resolve()) or not derivative.is_file():
                    sys.exit('[x] 朋友圈派生图缺失，旧清单保持不变')
            old = old_by_id.get(photo['id'], {})
            memory = memories.get(photo['id'])
            if memory is None and old.get('dateSource') == 'manual':
                memory = {'takenAt': old['takenAt'], 'season': old.get('season')}
            if memory is not None:
                photo.update(takenAt=memory['takenAt'], season=memory['season'], dateSource='manual')
                photo['datePrecision'] = 'unknown' if not photo['takenAt'] else 'year' if len(photo['takenAt']) == 4 else 'month' if len(photo['takenAt']) == 7 else 'day'
            custom = backup.get('photos', {}).get(photo['id'], old.get('tags', photo['tags']))
            photo['tags'] = ([season_names[photo['season']]] if photo['season'] else []) + [t for t in custom if t not in reserved]
            photo['chatDate'] = chat_links.get(photo['id'], old.get('chatDate', photo.get('chatDate')))
            photos.append(photo)
            known_ids.add(photo['id'])
            if photo.get('contentHash'):
                known_hashes.add(photo['contentHash'])
    photos.sort(key=lambda p: (p['takenAt'] or '', p['id']), reverse=True)
    for photo in photos:
        photo.pop('file', None)
        photo.pop('contentHash', None)
    payload = {'version': 2, 'generatedAt': datetime.now().isoformat(timespec='seconds'), 'count': len(photos), 'photos': photos}
    data = json.dumps(payload, ensure_ascii=False, indent=2)
    MANIFEST_JSON.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_JSON.with_suffix('.json.tmp').write_text(data, encoding='utf-8')
    MANIFEST_JS.with_suffix('.js.tmp').write_text('/* 自动生成：python tools/build_photos.py */\nwindow.PLANET_PHOTOS = ' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    MANIFEST_JSON.with_suffix('.json.tmp').replace(MANIFEST_JSON)
    MANIFEST_JS.with_suffix('.js.tmp').replace(MANIFEST_JS)
    log('[i] 时间来源：' + str(dict(Counter(p['dateSource'] for p in photos))))
    log('[i] 季节：' + str(dict(Counter(p['season'] or 'unknown' for p in photos))))
    log(f'[✓] 完成：{len(photos)} 张；{sum(not p["takenAt"] for p in photos)} 张日期留空。')


if __name__ == '__main__':
    main()
