const Rocky = require('./lib/rocky')

module.exports = rocky

/**
 * API factory
 */

function rocky(opts) {
  return new Rocky(opts)
}

/**
 * Internal modules
 */

rocky.Rocky          = Rocky
rocky.Base           = require('./lib/base')
rocky.Route          = require('./lib/route')
rocky.protocols      = require('./lib/protocols')
rocky.middleware     = require('./lib/middleware')
rocky.MiddlewarePool = require('./lib/mwpool')

/**
 * http-proxy module
 */

rocky.httpProxy = require('http-proxy')

/**
 * Current version
 */

rocky.VERSION = require('./package.json').version
