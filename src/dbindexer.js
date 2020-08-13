const bs58check = require('bs58check')

module.exports = (db) => {
  let currentTxid = null

  const isAddress = (txt) => {
    try {
      let decoded = bs58check.decode(txt)
      return decoded.length >= 33 && decoded.length <= 35
    } catch (e) {
      return false
    }
  }

  const extractAddresses = (k) => {
    let spls = k.split('/')
    return spls.filter(x => isAddress(x))
  }

  const put = async (k, v) => {
    if (!(k.startsWith('/_/')) && (currentTxid !== null)) {
      let addresses = extractAddresses(k)

      for (let i=0; i < addresses.length; i++) {
        const indexId = `/_/addr.${addresses[i]}`
        let ob = await db.get(indexId)
        if (!ob) {
          ob = {txs: {}}
        }

        ob[k] = currentTxid
        ob.txs[currentTxid] = Date.now()

        await db.put(indexId, ob)
      }
    }

    return await db.put(k, v)
  }

  const del = async (k) => {
    if (!(k.startsWith('/_/')) && (currentTxid !== null)) {
      let addresses = extractAddresses(k)

      for (let i=0; i < addresses.length; i++) {
        const indexId = `/_/addr.${addresses[i]}`
        let ob = await db.get(indexId)
        if (ob && k in ob) {
          delete ob[k]
          await db.put(indexId, ob)
        }
      }
    }

    return await db.del(k)
  }

  const start = () => {
    //
  }

  const commit = () => {
    currentTxid = null
    return db.commit()
  }

  const rollback = () => {
    currentTxid = null
    return db.rollback()
  }

  const setCurrentTxid = (txid) => {
    currentTxid = txid
  }

  return {
    ...db,
    put, del, commit, rollback, //start,
    setCurrentTxid
  }
}
