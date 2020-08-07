

module.exports = (db) => {
  let inTransaction = false
  let watchers = {}
  let notificationQueue = []

  const notify = (k, v) => {
    // TODO: This is a very naive approach to notification and could get out of hand
    let vals = Object.values(watchers)
    console.log('Notifying over', vals)
    for (let i=0; i < vals.length; i++) {
      const {regex, list} = vals[i]
      console.log('Notify test', regex, k, v)
      if (regex.test(k)) {
        list.forEach(cb => cb(k, v))
      }
    }
  }

  const put = (k, v) => {
    if (inTransaction) {
      notificationQueue.push({k, v})
    } else {
      notify(k, v)
    }

    return db.put(k, v)
  }

  const start = () => {
    inTransaction = true
    return db.start()
  }

  const commit = () => {
    inTransaction = false
    for (let i=0; i < notificationQueue.length; i++) {
      const {k, v} = notificationQueue[i]
      notify(k, v)
    }
    notificationQueue = []
    return db.commit()
  }

  const rollback = () => {
    inTransaction = false
    notificationQueue = []
    return db.rollback()
  }

  const registerWatcher = (path, watcher) => {
    if (!Array.isArray(path)) {
      path = [path]
    }

    for (let i=0; i < path.length; i++) {
      let item = path[i]
      if (item.startsWith('\\/')) {
        let r = new RegExp(item)
        if (!(path in watchers)) {
          watchers[path] = {regex: r, list: []}
        }
        watchers[path].list.push(watcher)
      }
    }
  }

  const unregisterWatcher = (path, watcher) => {
    if (!Array.isArray(path)) {
      path = [path]
    }

    for (let i=0; i < path.length; i++) {
      let item = path[i]
      if (item.startsWith('\\/') && item in watcher) {
        watchers[item].list = watchers[item].list.filter(x => x !== watcher)
      }
    }
  }

  return {
    ...db,
    put, start, commit, rollback,
    registerWatcher
  }
}
