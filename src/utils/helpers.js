export function camelToKebab(str) {
  if (!str) return ''
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export function formatDate(dateString) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null
  const [y, m, d] = dateString.split('-')
  return `${d}/${m}/${y}`
}
