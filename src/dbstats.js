const util = require('util')
module.exports = (db) => {
  const stats = {
    get: 0, put: 0, del: 0, start: 0, commit: 0, rollback: 0
  }
  const get = (k) => {
    stats.get++
    return db.get(k)
  }

  const put = (k, v) => {
    stats.put++
    return db.put(k, v)
  }

  const del = (k) => {
    stats.del++
    return db.del(k)
  }

  const start = () => {
    stats.start++
    return db.start()
  }

  const commit = (...args) => {
    stats.commit++
    return db.commit(...args)
  }

  const rollback = (...args) => {
    stats.rollback++
    return db.rollback(...args)
  }

  return {
    ...db,
    get, put, del, start, commit, rollback, stats
  }
}
