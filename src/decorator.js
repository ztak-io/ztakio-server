const rpcMethodDecorator = (name, method, mw) => async (args, opts, callback) => {
  const {req, res} = opts
  for (let i=0; i < mw.length; i++) {
    try {
      await mw[i](req)
    } catch (e) {
      callback(e.message)
      return
    }
  }

  if (Array.isArray(args)) {
    try {
      let val = await method(...args, opts)
      callback(null, val)
    } catch(e) {
      console.log(`While handling method '${name}'`, e)
      callback(e.message)
    }
  } else {
    callback('Params must be an array')
  }
}

const decorate = (methods, mw) => Object.fromEntries(Object.entries(methods).map(([k, v]) => ([k, rpcMethodDecorator(k, v, mw)])))

module.exports = decorate
