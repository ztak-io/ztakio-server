const { asm } = require('ztakio-core')

module.exports = async (core, db) => {
  let orderedEventList = []

  const orderedInsert = (k, v) => {
    let i = 0
    while (i < orderedEventList.length) {
      if (orderedEventList[i].params.timestamp.isLessThan(v.timestamp)) {
        i++
      } else {
        break
      }
    }
    orderedEventList = [].concat(orderedEventList.slice(0, i), [{key: k, params: v}], orderedEventList.slice(i))
  }

  db.registerWatcher('\\/_\\/cron\\..*', (k, v) => {
    orderedInsert(k, v)
  })

  let gen = db.iterator({ gt: '/_/cron.', lt: '/_/d' })
  while (item = await gen.next()) {
    if (item.done) {
      break
    }

    const {key, value} = item.value

    if (key && value) {
      orderedInsert(key, value)
    }
  }

  setInterval(async () => {
    while (orderedEventList.length > 0 && orderedEventList[0].params.timestamp <= Date.now()) {
      let item = orderedEventList.shift()
      await db.del(item.key)
      let {timestamp, entry, namespace, ...params} = item.params

      console.log('exec', entry, 'on namespace', namespace, 'with params', params)
      let cronCall = [ 'REQUIRE ' + namespace, 'NEW' ]

      for (let x in params) {
        cronCall.push(`PUSHS "${x}"`)
        let pushType
        let pushVal
        if ('sign' in params[x]) {
          pushType = 'PUSHI'
          pushVal = asm.safeToString(params[x])
        } else {
          pushType = 'PUSHS'
          pushVal = '"' + asm.safeToString(params[x]) + '"'
        }
        cronCall.push(`${pushType} ${pushVal}`)
        cronCall.push('SETO')
      }

      cronCall.push('ECALL ' + namespace + ':' + entry)
      cronCall.push('END')
      let code = cronCall.join('\n')
      let compiled = asm.compile(code)
      let executor = core('')
      await executor(compiled)
    }
  }, 1000).unref()
}
