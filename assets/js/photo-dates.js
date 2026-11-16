/* 日期只记到年、月也可以；不把文件导出时间当作拍摄时间。 */
(() => {
  'use strict';
  const names = { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天', ...window.SITE_CONFIG?.seasons?.names };
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const months = window.SITE_CONFIG?.seasons?.months;
  const allMonths = months && seasons.flatMap(s => months[s] || []);
  const customMonths = allMonths && allMonths.length === 12 && new Set(allMonths).size === 12 && allMonths.every(n => Number.isInteger(n) && n >= 1 && n <= 12);
  function valid(value) {
    if (value === null) return true;
    if (typeof value !== 'string' || !/^[12]\d{3}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2})?)?)?$/.test(value)) return false;
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    if (m !== undefined && (m < 1 || m > 12)) return false;
    if (d !== undefined && (d < 1 || d > new Date(y, m, 0).getDate())) return false;
    return value.length <= 10 || (Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60);
  }
  const precision = value => !value ? 'unknown' : value.length === 4 ? 'year' : value.length === 7 ? 'month' : 'day';
  function fromMonth(month) {
    if (!(month >= 1 && month <= 12)) return null;
    if (customMonths) return seasons.find(s => months[s].includes(month));
    return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
  }
  const seasonOf = photo => fromMonth(Number(photo.takenAt?.slice(5, 7))) || (Object.hasOwn(names, photo.season) ? photo.season : null);
  const groupKey = photo => photo.takenAt?.slice(0, 7) || 'unknown';
  function pretty(value) {
    if (!value) return '日期还没记下';
    if (value.length === 4) return `${value} 年 · 月日待补`;
    if (value.length === 7) return `${value.replace('-', '.')} · 日子待补`;
    return value.slice(0, 10).replace(/-/g, '.');
  }
  function groupTitle(key) {
    if (key === 'unknown') return '那些忘了日期的日子';
    if (key.length === 4) return `${key} 年 · 月份还没记下`;
    return `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`;
  }
  const compare = (a, b) => (b.takenAt || '').localeCompare(a.takenAt || '') || b.id.localeCompare(a.id);
  const compareGroups = (a, b) => (b === 'unknown' ? '' : b).localeCompare(a === 'unknown' ? '' : a);
  window.PLANET_DATES = { names, valid, precision, fromMonth, seasonOf, groupKey, pretty, groupTitle, compare, compareGroups };
})();
