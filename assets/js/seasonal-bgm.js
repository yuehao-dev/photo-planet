/* V4.2 四季音乐：同步循环、主旋律等功率淡变、伴奏互补淡变。 */
(() => {
  'use strict';
  class SeasonalBGM {
    constructor({ baseUrl = 'assets/audio/stems/', sets = [], fadeSeconds = 7, volume = .55, onStateChange = () => {} } = {}) {
      this.baseUrl = baseUrl;
      this.sets = sets.length ? sets : [{ id: 'paper-v42', title: '纸页之间', baseUrl, duration: 120, format: 'stems' }];
      this.collection = this.sets[0].id;
      this.fadeSeconds = fadeSeconds;
      this.volume = volume;
      this.loopSeconds = 120;
      this.seasons = ['spring', 'summer', 'autumn', 'winter'];
      this.selected = 'autumn';
      this.context = null;
      this.master = null;
      this.epoch = null;
      this.voices = new Map();
      this.buffers = new Map();
      this.loadTask = null;
      this.requestId = 0;
      this.wantsPlayback = false;
      this.destroyed = false;
      this.state = 'idle';
      this.onStateChange = onStateChange;
    }

    _emit(state, error = null) {
      this.state = state;
      this.onStateChange({ state, season: this.selected, collection: this.collection, error });
    }

    _ensureContext() {
      if (this.destroyed) throw new Error('播放器已关闭');
      if (this.context) return;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('浏览器暂不支持音乐播放');
      // 按需解码，每季两条声部；过渡完成即释放已退出季节的缓冲。
      try { this.context = new Audio({ sampleRate: 32000, latencyHint: 'playback' }); }
      catch (_) { this.context = new Audio(); }
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      this.sweepTimer = setInterval(() => this._sweep(), 250);
    }

    _key(season, setId = this.collection) { return `${setId}:${season}`; }

    async _load(season) {
      const key = this._key(season);
      const set = this.sets.find(item => item.id === this.collection);
      if (this.buffers.has(key)) return this.buffers.get(key);
      if (this.loadTask?.key === key && !this.loadTask.controller.signal.aborted) return this.loadTask.promise;
      this.loadTask?.controller.abort();
      const controller = new AbortController();
      const task = { key, controller };
      task.promise = (async () => {
        const result = { collection: set.id, duration: set.duration || 0, lead: null, backing: null };
        const base = set.baseUrl || this.baseUrl;
        const supportsOgg = !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"');
        const resolve = file => new URL(file, new URL(base.replace(/\/?$/, '/'), document.baseURI)).href;
        const parts = set.format === 'tracks' ? ['lead'] : ['lead', 'backing'];
        for (const part of parts) {
          const track = set.tracks?.[season];
          const options = set.format === 'tracks' ? (Array.isArray(track) ? track : [track]) :
            (supportsOgg ? ['ogg', 'm4a', 'flac'] : ['m4a', 'flac']).map(ext => `${season}-${part}.${ext}`);
          if (!options[0]) throw new Error('这一组的四季音频还没配齐');
          for (let i = 0; i < options.length; i++) {
            if (controller.signal.aborted) throw new DOMException('已选择其他季节', 'AbortError');
            let timeout;
            try {
              timeout = setTimeout(() => controller.abort(), 30000);
              const response = await (window.PLANET_MEDIA?.fetch || fetch)(resolve(options[i]), { signal: controller.signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const bytes = await response.arrayBuffer();
              const buffer = await this.context.decodeAudioData(bytes);
              if (controller.signal.aborted || this.destroyed) throw new DOMException('已取消', 'AbortError');
              if (set.format !== 'tracks' && result.duration && Math.abs(buffer.duration - result.duration) > .02) throw new Error('音乐循环长度不一致');
              result[part] = buffer;
              break;
            } catch (error) {
              if (controller.signal.aborted || i === options.length - 1) throw error;
            } finally { clearTimeout(timeout); }
          }
        }
        if (set.format === 'tracks') result.duration = result.lead.duration;
        this.buffers.set(key, result);
        return result;
      })();
      this.loadTask = task;
      try { return await task.promise; }
      finally { if (this.loadTask === task) this.loadTask = null; }
    }

    async play(season = this.selected) {
      if (!this.seasons.includes(season) || this.destroyed) return;
      if (season === this.selected && this.wantsPlayback && ['loading', 'playing', 'transitioning'].includes(this.state) && this.context?.state === 'running' && this.voices.get(this._key(season))?.target === 1) return;
      this.selected = season;
      this.wantsPlayback = true;
      const id = ++this.requestId;
      clearTimeout(this.pauseTimer);
      clearTimeout(this.stateTimer);
      if (this.loadTask?.key !== this._key(season)) this.loadTask?.controller.abort();
      try {
        this._ensureContext();
        // 在点击的调用栈里解锁，不等网络返回后才 resume。
        const resumed = this.context.resume();
        this._emit('loading');
        if (this.context.state !== 'running' && !navigator.userActivation?.isActive) {
          await Promise.race([resumed, new Promise(resolve => setTimeout(resolve, 450))]);
          if (id !== this.requestId || !this.wantsPlayback) return;
          if (this.context.state !== 'running') { this.wantsPlayback = false; this._emit('blocked'); return; }
        } else await resumed;
        if (id !== this.requestId || !this.wantsPlayback) return;
        const buffer = await this._load(season);
        if (id !== this.requestId || !this.wantsPlayback || this.destroyed) { this._sweep(); return; }
        const end = this._transition(season, buffer);
        this._setMaster(this.volume, .35);
        this._emit('transitioning');
        this.stateTimer = setTimeout(() => {
          if (id === this.requestId && this.wantsPlayback) this._emit('playing');
        }, Math.max(0, end - this.context.currentTime) * 1000);
      } catch (error) {
        if (id !== this.requestId || this.destroyed) return;
        if (error.name === 'NotAllowedError' && !this.voices.size) {
          this.wantsPlayback = false; this._emit('blocked'); return;
        }
        this.wantsPlayback = this.voices.size > 0;
        // 新资源失败时旧音乐继续，给用户保留重试入口。
        this._emit('error', error);
      }
    }

    setCollection(id) {
      if (!this.sets.some(set => set.id === id)) throw new Error('这组旋律还没来到');
      if (id === this.collection) return;
      this.collection = id;
      if (this.wantsPlayback) return this.play(this.selected);
      this._emit(this.context ? 'paused' : 'idle');
    }

    switchTo(season) {
      if (!this.seasons.includes(season)) return;
      if (this.wantsPlayback) return this.play(season);
      this.selected = season;
      this._emit(this.state === 'blocked' ? 'blocked' : this.context ? 'paused' : 'idle');
    }

    _value(voice, time, lead = false) {
      const ramp = lead ? voice.leadRamp : voice.ramp;
      if (!ramp) return 0;
      const p = Math.max(0, Math.min(1, (time - ramp.t0) / (ramp.t1 - ramp.t0)));
      const s = p * p * (3 - 2 * p);
      return lead ? Math.sqrt(Math.max(0, ramp.v0 ** 2 * (1 - s) + ramp.v1 ** 2 * s)) : ramp.v0 + (ramp.v1 - ramp.v0) * s;
    }

    _transition(season, buffer) {
      const ctx = this.context;
      const now = ctx.currentTime;
      const start = now + .025;
      const duration = this.voices.size ? this.fadeSeconds : 2;
      if (this.epoch === null) this.epoch = start;
      const key = this._key(season, buffer.collection);
      if (!this.voices.has(key)) {
        const voice = { season, collection: buffer.collection, target: 0, ramp: null, leadRamp: null };
        const length = buffer.duration;
        const offset = ((start - this.epoch) % length + length) % length;
        for (const part of ['lead', 'backing']) {
          const source = ctx.createBufferSource();
          const gain = ctx.createGain();
          source.buffer = buffer[part] || ctx.createBuffer(1, 1, ctx.sampleRate);
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = buffer[part] ? length : 1 / ctx.sampleRate;
          gain.gain.value = 0;
          source.connect(gain);
          gain.connect(this.master);
          source.start(start, buffer[part] ? offset : 0);
          if (part === 'lead') { voice.leadSource = source; voice.leadGain = gain; }
          else { voice.source = source; voice.gain = gain; }
        }
        this.voices.set(key, voice);
      }
      for (const [name, voice] of this.voices) {
        voice.target = name === key ? 1 : 0;
        for (const lead of [false, true]) {
          // 重入过渡从此刻的实际音量接续，不复位、不截断旧声部。
          const current = this._value(voice, now, lead);
          const param = (lead ? voice.leadGain : voice.gain).gain;
          if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
          else param.cancelScheduledValues(now);
          param.setValueAtTime(current, now);
          param.setValueAtTime(current, start);
          const ramp = { t0: start, t1: start + duration, v0: current, v1: voice.target };
          if (lead) voice.leadRamp = ramp; else voice.ramp = ramp;
          for (let step = 1; step <= 192; step++) {
            const at = start + duration * step / 192;
            param.linearRampToValueAtTime(this._value(voice, at, lead), at);
          }
        }
      }
      return start + duration;
    }

    _setMaster(target, duration) {
      const now = this.context.currentTime;
      const param = this.master.gain;
      const current = param.value;
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
      else param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
      param.linearRampToValueAtTime(target, now + duration);
    }

    _sweep() {
      if (!this.context || this.destroyed) return;
      const now = this.context.currentTime;
      for (const [season, voice] of this.voices) {
        if (voice.target === 0 && voice.ramp && now > voice.ramp.t1 + .05) {
          this._stopVoice(voice);
          this.voices.delete(season);
        }
      }
      for (const season of this.buffers.keys()) {
        if (!this.voices.has(season) && season !== this._key(this.selected)) this.buffers.delete(season);
      }
    }

    _stopVoice(voice) {
      for (const source of [voice.source, voice.leadSource]) { try { source.stop(); } catch (_) {} source.disconnect(); }
      voice.gain.disconnect(); voice.leadGain.disconnect();
    }

    pause() {
      this.wantsPlayback = false;
      ++this.requestId;
      this.loadTask?.controller.abort();
      clearTimeout(this.stateTimer);
      clearTimeout(this.pauseTimer);
      if (this.context) {
        this._setMaster(0, .45);
        this.pauseTimer = setTimeout(() => {
          if (!this.wantsPlayback && !this.destroyed) this.context.suspend().catch(() => {});
        }, 500);
      }
      this._emit('paused');
    }

    setVolume(value) {
      this.volume = Math.max(0, Math.min(1, Number(value) || 0));
      if (this.master && this.wantsPlayback) this._setMaster(this.volume, .18);
    }

    getPosition() { return this.context && this.epoch !== null ? Math.max(0, this.context.currentTime - this.epoch) % this.loopSeconds : 0; }

    getSnapshot() {
      const now = this.context?.currentTime || 0;
      return { state: this.state, selected: this.selected, collection: this.collection, wantsPlayback: this.wantsPlayback, position: this.getPosition(), time: now,
        voices: [...this.voices].map(([key, voice]) => ({ key, season: voice.season, collection: voice.collection, lead: this._value(voice, now, true), backing: this._value(voice, now), target: voice.target })),
        decodedSeasons: [...this.buffers.keys()] };
    }

    async destroy() {
      this.destroyed = true; this.wantsPlayback = false; ++this.requestId;
      this.loadTask?.controller.abort();
      clearInterval(this.sweepTimer); clearTimeout(this.pauseTimer); clearTimeout(this.stateTimer);
      this.voices.forEach(voice => this._stopVoice(voice));
      this.voices.clear(); this.buffers.clear();
      if (this.context) await this.context.close();
    }
  }
  window.PLANET_SeasonalBGM = SeasonalBGM;
})();
