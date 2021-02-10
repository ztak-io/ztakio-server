
module.exports = (db, ldb) => {
  let minkey = null
  let maxkey = null
  let inTx = false
  let inCompaction = false
  let txSem = null

  setInterval(async () => {
    if (inCompaction) return

    if (minkey && maxkey) {
      inCompaction = true
      try {
        if (inTx) {
          let prom = new Promise((resolve) => {
            txSem = resolve
          })
          await prom
          txSem = null
        }

        await ldb.compactRange(minkey, maxkey)
        minkey = null
        maxkey = null
      } finally {
        inCompaction = false
      }
    }
  }, 3600000)

  const put = (k, v) => {
    if (minkey === null) {
      minkey = k
    } else if (maxKey.localeCompare(k) > 0) {
      minkey = k
    }

    if (maxkey === null) {
      maxkey = k
    } else if (maxKey.localeCompare(k) < 0) {
      maxkey = k
    }
    return db.put(k, v)
  }

  const start = () => {
    inTx = true
    return db.start()
  }

  const commit = (...args) => {
    inTx = false
    if (txSem) {
      txSem()
    }

    return db.commit(...args)
  }

  const rollback = (...args) => {
    inTx = false
    if (txSem) {
      txSem()
    }
    return db.rollback(...args)
  }

  return {
    ...db,
    put, start, commit, rollback
  }
}
