#!/usr/bin/env python3
"""Rebuild wholly fictional demo art and conversations. No network or private inputs.

Only explicitly named demo files are overwritten; unrelated user files are retained.
Run in a fresh checkout, not in a personal data directory.
"""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import random
import shutil
import struct
import wave
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TZ = timezone(timedelta(hours=8))
SEASONS = ['spring', 'summer', 'autumn', 'winter']
PALETTES = [
    ('#eee5d4', '#bfd3be', '#789b7d', '#3e6c55', '#eaaaad'),
    ('#e8e4cc', '#9cc9cd', '#5e9f99', '#285f69', '#f3bb69'),
    ('#eee0cb', '#d6b78e', '#bd8556', '#6d6549', '#d86e45'),
    ('#e9e7df', '#c0d0d2', '#8fa7ad', '#526d79', '#d19e96'),
]


def write_json(rel, value):
    target = ROOT / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def artwork(season, scene, size=(1200, 960)):
    """Original geometric still lifes and landscapes, not edited personal photos."""
    rng = random.Random(season * 100 + scene)
    sky, light, mid, dark, accent = PALETTES[season]
    im = Image.new('RGB', (1200, 1100), sky)
    d = ImageDraw.Draw(im)
    # Paper-like flecks are deterministic and contain no embedded metadata.
    for _ in range(1600):
        x, y = rng.randrange(1200), rng.randrange(1100)
        d.line((x, y, x + 1, y), fill='#e3dbc9')
    if scene in (0, 3):
        d.ellipse((820, 90, 1020, 290), fill='#f5d797')
        d.polygon([(0, 600), (300, 310), (650, 650), (1000, 280), (1200, 510), (1200, 1100), (0, 1100)], fill=light)
        d.polygon([(0, 810), (330, 630), (750, 800), (1200, 570), (1200, 1100), (0, 1100)], fill=mid)
        d.polygon([(0, 990), (380, 800), (860, 970), (1200, 780), (1200, 1100), (0, 1100)], fill=dark)
        if scene == 0:
            d.rounded_rectangle((450, 500, 745, 790), 15, fill='#f9f0de')
            d.polygon([(408, 520), (596, 360), (785, 520)], fill=accent)
            d.rounded_rectangle((555, 630, 637, 790), 7, fill=dark)
            for x in (480, 661):
                d.rectangle((x, 570, x + 50, 620), fill=light)
                d.line((x + 25, 570, x + 25, 620), fill=dark, width=4)
        else:
            d.arc((420, 700, 800, 1150), 190, 350, fill='#e4cfad', width=70)
            for i in range(9):
                x = 100 + i * 125
                y = 650 + (i % 3) * 63
                d.line((x, y, x - 15, y + 190), fill=dark, width=11)
                d.ellipse((x - 50, y - 60, x + 50, y + 30), fill=accent)
    elif scene in (1, 4):
        d.rounded_rectangle((155, 75, 1045, 790), 30, fill=dark)
        d.rectangle((190, 105, 1010, 750), fill=light)
        d.ellipse((770, 160, 920, 310), fill='#fbe5ac')
        for x in range(210, 1000, 160):
            d.ellipse((x - 70, 550, x + 160, 900), fill=mid)
        d.line((605, 90, 605, 770), fill=sky, width=24)
        d.line((180, 410, 1020, 410), fill=sky, width=22)
        d.rectangle((0, 790, 1200, 1100), fill='#c49e7d')
        d.ellipse((230, 880, 650, 1020), fill='#e7cfb1')
        if scene == 1:
            d.ellipse((550, 795, 725, 955), fill=dark)
            d.ellipse((575, 818, 701, 931), fill='#c49e7d')
            d.rounded_rectangle((270, 755, 610, 955), 50, fill='#f9f0de')
            d.ellipse((270, 750, 610, 820), fill='#e8dbbf')
            d.ellipse((295, 762, 585, 807), fill='#74604e')
            for x in (350, 435, 520):
                d.arc((x, 625, x + 48, 745), 80, 270, fill=sky, width=10)
        else:
            for i, color in enumerate((accent, dark, '#f4e3bc')):
                d.rounded_rectangle((240 + i * 30, 850 - i * 65, 790 + i * 30, 910 - i * 65), 10, fill=color)
                d.line((310 + i * 30, 860 - i * 65, 310 + i * 30, 900 - i * 65), fill=sky, width=4)
            d.line((940, 620, 940, 950), fill=dark, width=12)
            d.polygon([(840, 700), (1040, 700), (980, 510), (900, 510)], fill='#f1d391')
    elif scene == 2:
        d.rectangle((0, 630, 1200, 1100), fill=mid)
        for y in range(700, 1100, 95):
            d.arc((-150, y, 1300, y + 170), 200, 340, fill=light, width=10)
        d.ellipse((800, 160, 980, 340), fill='#f7dfac')
        d.polygon([(200, 600), (590, 140), (590, 600)], fill='#fff5db')
        d.polygon([(610, 600), (610, 240), (860, 600)], fill=accent)
        d.line((600, 140, 600, 730), fill=dark, width=12)
        d.polygon([(140, 640), (950, 640), (840, 780), (310, 780)], fill=dark)
        for x, y in [(170, 170), (340, 270)]:
            d.arc((x, y, x + 90, y + 50), 180, 350, fill=dark, width=6)
    else:
        d.ellipse((160, 780, 1040, 1070), fill=light)
        d.rounded_rectangle((460, 560, 760, 940), 40, fill=accent)
        for i in range(7):
            angle = i * .85
            x, y = 600 + math.cos(angle) * 230, 360 + math.sin(angle) * 190
            d.line((600, 720, int(x), int(y)), fill=dark, width=12)
            for petal in range(5):
                a = petal * math.tau / 5
                px, py = x + math.cos(a) * 37, y + math.sin(a) * 37
                d.ellipse((px - 35, py - 35, px + 35, py + 35), fill='#f9efda')
            d.ellipse((x - 25, y - 25, x + 25, y + 25), fill='#e7b653')
        d.ellipse((495, 550, 725, 610), fill=dark)
    if season == 3:
        for _ in range(70):
            x, y = rng.randrange(1200), rng.randrange(1000)
            d.ellipse((x, y, x + 8, y + 8), fill='#fffaf0')
    elif season == 0:
        for _ in range(30):
            x, y = rng.randrange(1200), rng.randrange(1000)
            d.ellipse((x, y, x + 14, y + 7), fill='#efbdc4')
    return im.resize(size, Image.Resampling.LANCZOS)


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm', action='store_true', help='Confirm replacing the demo manifests in this checkout')
    if not parser.parse_args().confirm:
        parser.error('Use --confirm only in a demo checkout; personal manifests must be backed up separately.')
    if (ROOT / '.private-mode').exists():
        parser.error('Demo regeneration is disabled in a personal-data checkout.')
    photos = []
    for si, season in enumerate(SEASONS):
        for scene in range(6):
            month = [3, 6, 9, 12][si]
            day = f'2025-{month:02d}-{8 + scene * 3:02d}'
            size = [(1200, 960), (1000, 1280), (1280, 880)][scene % 3]
            image = artwork(si, scene, size)
            identity = f'demo-{season}-{scene + 1}'
            checksum = hashlib.sha256(image.tobytes()).hexdigest()[:16]
            thumb = f'public/photos/thumb/{identity}-{checksum}.webp'
            full = f'public/photos/full/{identity}-{checksum}.webp'
            for name, max_size in [(thumb, (660, 660)), (full, (1500, 1500))]:
                target = ROOT / name; target.parent.mkdir(parents=True, exist_ok=True)
                derived = image.copy(); derived.thumbnail(max_size)
                derived.save(target, 'WEBP', quality=84, method=6)
            taken = None if si == 0 and scene == 5 else day[:7] if si == 2 and scene == 5 else day
            photos.append(dict(id=identity, thumbUrl=thumb, fullUrl=full, width=size[0], height=size[1], ratio=size[0] / size[1],
                               orientation='portrait' if size[1] > size[0] else 'landscape', takenAt=taken,
                               datePrecision='unknown' if taken is None else 'month' if len(taken) == 7 else 'day',
                               dateSource='manual' if taken else 'unknown', season=season, chatDate=day,
                               tags=[['春日散步', '夏日小事', '秋天来信', '冬日灯火'][si], ['小屋', '咖啡', '海风', '散步', '书页', '花束'][scene]],
                               sourceType='demo', demoDate=day))
    # Generate demo attachment bytes, with purely synthetic identifiers.
    media = ROOT / 'demo-media/chat-assets'; media.mkdir(parents=True, exist_ok=True)
    image_hash = hashlib.sha256(b'photo-planet-fictional-attachment-image').hexdigest()
    image_path = f'chat-assets/{image_hash}.webp'
    shutil.copyfile(ROOT / photos[0]['thumbUrl'], ROOT / 'demo-media' / image_path)
    sound_hash = hashlib.sha256(b'photo-planet-fictional-attachment-chime').hexdigest()
    sound_path = f'chat-assets/{sound_hash}.wav'
    with wave.open(str(ROOT / 'demo-media' / sound_path), 'wb') as w:
        w.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        w.writeframes(b''.join(struct.pack('<h', int(4500 * math.sin(math.tau * 523.25 * n / 16000) * math.exp(-n / 4000) * min(1, n / 160))) for n in range(16000)))
    phrases = [
        ('her', '今天的风有一点像刚洗好的被子。'), ('me', '那我们把窗户开一小会儿。'),
        ('her', '路过一家小花店，想起你喜欢的颜色。'), ('me', '留到周末，我们一起挑一束。'),
        ('her', '刚煮好的面，第一口最好吃。'), ('me', '等我两分钟，把葱花也留一点。'),
        ('her', '公交车转弯的时候，夕阳刚好照过来。'), ('me', '你拍下来了吗？'),
        ('her', '拍了一张，有点歪，但是很好看。'), ('me', '歪一点也没关系，是今天的样子。'),
        ('her', '今晚想早点睡，明天去看河边的树。'), ('me', '好，早餐我来准备。'),
        ('her', '柠檬汽水还是要冰冰的。'), ('me', '我选热可可，我们一人分对方一口。'),
        ('her', '这一天没有什么大事，但很开心。'), ('me', '那就把它也放进相册里。'),
        ('her', '书只看了两页，猫倒是睡了一下午。'), ('me', '两页也算数，慢慢看。'),
        ('her', '雨停了，楼下的叶子亮晶晶。'), ('me', '穿好外套，我们下楼走走。'),
        ('her', '明天不用赶路，可以绕一点远。'), ('me', '听你的，顺路买一袋栗子。'),
        ('her', '回家的时候记得抬头，有一弯月亮。'), ('me', '看见了。晚安，明天再见。'),
    ]
    index = dict(version=1, generation='fictional-demo-v1', updatedAt='2025-12-23T20:00:00+08:00', timeZone='Asia/Shanghai', count=0, days={})
    previous = None
    for pi, photo in enumerate(photos):
        date = photo.pop('demoDate')
        count = 200 if pi % 6 == 0 else 24
        start = datetime.fromisoformat(date + 'T17:30:00+08:00')
        messages = []
        for n in range(count):
            sender, text = phrases[n % len(phrases)]
            if n >= 24:
                text += f'（虚构演示片段 {n // 24 + 1}）'
            when = start + timedelta(seconds=n * 37)
            mid = 'm_' + hashlib.md5(f'fictional:{date}:{n}'.encode()).hexdigest()
            messages.append(dict(id=mid, sender=sender, text=text, timestamp=int(when.timestamp()), time=when.strftime('%H:%M:%S'), type='文本', kind='text'))
        if previous:
            messages[0]['quote'] = dict(sender='her', text='这一天没有什么大事，但很开心。', target=previous)
        messages[6].update(text='今天路边的小房子，给你看。（程序插画演示）', kind='image', media=[dict(kind='image', url=image_path, thumb=image_path, width=660, height=528)])
        messages[10].update(text='一声轻轻的提示音。（合成音效，并非真人语音）', kind='audio', media=[dict(kind='audio', url=sound_path)])
        messages[15].update(text='分享一个占位链接。', link=dict(url='https://example.com/', title='示例链接 · example.com'))
        chunks = []
        mappings = {}
        for offset in range(0, count, 80):
            part = offset // 80; url = f'days/{date}/demo/chunk-{part:04d}.json'
            rows = messages[offset:offset + 80]
            chunks.append(dict(url=url, startIndex=offset, count=len(rows), startTime=rows[0]['timestamp'], endTime=rows[-1]['timestamp']))
            mappings.update({m['id']: part for m in rows})
            write_json('data/chat/' + url, dict(date=date, startIndex=offset, messages=rows))
        url = f'days/{date}/demo/index.json'
        write_json('data/chat/' + url, dict(version=1, date=date, count=count, chunks=chunks, messageChunks=mappings))
        index['days'][date] = dict(count=count, url=url); index['count'] += count
        previous = dict(date=date, chunk=0, id=messages[14]['id'])
    write_json('data/chat/index.json', index)
    payload = dict(version=2, generatedAt='2025-12-23T20:00:00+08:00', count=len(photos), photos=photos)
    write_json('data/photos.json', payload)
    (ROOT / 'data/photos.js').write_text('window.PLANET_PHOTOS = ' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    # Derive generic PNG/ICO assets from a new original planet drawing.
    icon = Image.new('RGBA', (256, 256), '#faf6ee'); draw = ImageDraw.Draw(icon)
    draw.ellipse((61, 51, 195, 185), fill='#ff805d')
    draw.arc((22, 83, 233, 166), 0, 360, fill='#7b947b', width=16)
    draw.ellipse((185, 29, 202, 46), fill='#e7bd58')
    out = ROOT / 'assets/icons'; out.mkdir(parents=True, exist_ok=True)
    icon.resize((180, 180)).save(out / 'apple-touch-icon.png')
    icon.resize((32, 32)).save(out / 'favicon-32.png')
    icon.save(out / 'favicon.ico', sizes=[(16, 16), (32, 32), (64, 64)])
    print(json.dumps({'photos': len(photos), 'chatDays': len(index['days']), 'messages': index['count'], 'allFictional': True}))


if __name__ == '__main__':
    main()
