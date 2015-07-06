const fs = require('fs')
const http = require('http')
const connect = require('connect')
const sinon = require('sinon')
const supertest = require('supertest')
const expect = require('chai').expect
const rocky = require('..')

const ports = { target: 9890, proxy: 9891, replay: 9892 }
const baseUrl = 'http://127.0.0.1'
const proxyUrl = baseUrl + ':' + ports.proxy
const targetUrl = baseUrl + ':' + ports.target
const replayUrl = baseUrl + ':' + ports.replay
const noop = function () {}

suite('rocky', function () {
  var proxy, replay, server

  beforeEach(function () {
    proxy = replay = server = null
  })

  afterEach(function (done) {
    if (replay) replay.close()
    if (server) server.close()
    if (proxy && proxy.server) {
      proxy.server.close()
    }
    setTimeout(done, 10)
  })

  test('simple forward', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .listen(ports.proxy)

    server = createTestServer(assert)

    proxy.get('/test')
    http.get(proxyUrl + '/test', noop)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
      done()
    }
  })

  test('forward and replay', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy.get('/test')

    replay = createReplayServer(assertReplay)
    server = createTestServer(assert)

    supertest(proxyUrl)
      .get('/test')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(done)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)
    }
  })

  test('forward and replay to multiple backends', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .replay(replayUrl)
      .replay(replayUrl)
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy.get('/test')

    replay = createReplayServer(assertReplay)
    server = createTestServer(assert)

    supertest(proxyUrl)
      .get('/test')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(noop)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
    }

    var asserts = 0
    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)

      asserts += 1
      if (asserts === 3) {
        done()
      }
    }
  })

  test('forward and replay with payload', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy.post('/test')

    replay = createReplayServer(assertReplay)
    server = createTestServer(assert)

    supertest(proxyUrl)
      .post('/test')
      .send({ hello: 'world' })
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(done)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
      expect(req.body).to.match(/hello/)
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)
      expect(req.body).to.match(/hello/)
    }
  })

  test('forward and replay a large payload', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .replay(replayUrl)
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy.post('/test')

    replay = createReplayServer(assertReplay)
    server = createTestServer(assert)

    var body = randomString()
    supertest(proxyUrl)
      .post('/test')
      .type('text/plain')
      .send(body)
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(done)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
      expect(req.body).to.be.equal(body)
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)
      expect(req.body).to.be.equal(body)
    }
  })

  test('middleware', function (done) {
    proxy = rocky().forward(targetUrl)
    server = createTestServer(assert)

    var mwspy = sinon.spy()
    proxy.use(function (req, res, next) {
      mwspy(req, res)
      next()
    })

    var routespy = sinon.spy()
    proxy.get('/test')
      .use(function (req, res, next) {
        routespy(req, res)
        next()
      })

    proxy.listen(ports.proxy)

    supertest(proxyUrl)
      .get('/test')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(done)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
      expect(mwspy.calledOnce).to.be.true
      expect(routespy.calledOnce).to.be.true
    }
  })

  test('intercept and transform response payload', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .replay(replayUrl)
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy
      .post('/payload')
      .transformResponseBody(function (req, res, next) {
        var body = JSON.parse(res.body.toString())
        var newBody = JSON.stringify({ salutation: 'hello ' + body.hello })
        next(null, newBody)
      })

    replay = createReplayServer(assert)
    server = createTestServer(assert)

    supertest(proxyUrl)
      .post('/payload')
      .type('application/json')
      .send('{"hello": "world"}')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect('{"salutation":"hello world"}')
      .end(done)

    function assert(req, res) {
      expect(req.url).to.be.equal('/payload')
      expect(res.statusCode).to.match(/200|204/)
    }
  })

  test('intercept and transform request payload', function (done) {
    proxy = rocky()
      .forward(targetUrl)
      .replay({ target: replayUrl, forwardOriginalBody: true })
      .replay({ target: replayUrl, forwardOriginalBody: true })
      .listen(ports.proxy)

    proxy
      .post('/payload')
      .transformRequestBody(function (req, res, next) {
        var body = JSON.parse(req.body.toString())
        var newBody = JSON.stringify({ salutation: 'hello ' + body.hello })
        next(null, newBody)
      })

    replay = createReplayServer(assertReplay)
    server = createTestServer(assert)

    supertest(proxyUrl)
      .post('/payload')
      .type('application/json')
      .send('{"hello":"world"}')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({'hello': 'world'})
      .end(end)

    function end(err) {
      setTimeout(function () { done(err) }, 50)
    }

    function assert(req, res) {
      expect(req.url).to.be.equal('/payload')
      expect(res.statusCode).to.be.equal(200)
      expect(req.body).to.be.equal('{"salutation":"hello world"}')
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/payload')
      expect(res.statusCode).to.be.equal(204)
      expect(req.body).to.be.equal('{"hello":"world"}')
    }
  })

  test('route', function (done) {
    var spy = sinon.spy()
    proxy = rocky()
    server = createTestServer(assert)
    replay = createReplayServer(assertReplay)

    proxy.get('/test')
      .forward(targetUrl)
      .replay(replayUrl)
      .options({ hostRewrite: true })
      .on('proxyReq', spy)
      .on('replay:start', spy)
      .on('error', spy)
      .use(function (req, res, next) {
        req.headers['X-Test'] = 'rocky'
        next()
      })

    proxy.listen(ports.proxy)

    supertest(proxyUrl)
      .get('/test')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(end)

    function end() {
      expect(spy.calledTwice).to.be.true
      done()
    }

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
      expect(req.headers['x-test']).to.be.equal('rocky')
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)
      expect(req.headers['x-test']).to.be.equal('rocky')
    }
  })

  test('missing target', function (done) {
    var spy = sinon.spy()
    proxy = rocky()

    proxy.get('/test')
      .on('error', spy)
      .on('proxyReq', spy)
      .on('route:error', spy)

    proxy.listen(ports.proxy)

    supertest(proxyUrl)
      .get('/test')
      .expect(502)
      .expect('Content-Type', 'application/json')
      .end(assert)

    function assert(err, res) {
      var errorMsg = /Cannot forward the request/i
      expect(spy.calledOnce).to.be.true
      expect(res.statusCode).to.be.equal(502)
      expect(spy.args[0][0].message).to.match(errorMsg)
      expect(spy.args[0][1].url).to.be.equal('/test')
      expect(res.body.message).to.match(errorMsg)
      done()
    }
  })

  test('missing route', function (done) {
    var spy = sinon.spy()
    proxy = rocky()

    proxy
      .on('route:missing', spy)

    proxy.listen(ports.proxy)

    supertest(proxyUrl)
      .get('/test')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(end)

    function end(err, res) {
      expect(spy.calledOnce).to.be.true
      expect(res.statusCode).to.be.equal(502)
      expect(res.body.message).to.be.equal('No route configured')
      done()
    }
  })


  test('unavailable forward server', function (done) {
    var spy = sinon.spy()
    proxy = rocky()

    proxy.get('/test')
      .forward('http://invalid.server')
      .on('proxyReq', spy)
      .on('proxy:error', spy)

    proxy.listen(ports.proxy)

    supertest(proxyUrl)
      .get('/test')
      .expect(502)
      .expect('Content-Type', 'application/json')
      .expect(/ENOTFOUND/)
      .end(end)

    function end(err, res) {
      expect(spy.calledTwice).to.be.true
      expect(spy.args[1][0].message).to.match(/ENOTFOUND/)
      done()
    }
  })

  test('replay without forwarding', function (done) {
    var spy = sinon.spy()

    replay = createReplayServer(assertReplay)
    proxy = rocky()
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy.get('/test')
      .on('proxyReq', spy)
      .on('route:error', spy)

    supertest(proxyUrl)
      .get('/test')
      .expect(404)
      .expect('Content-Type', 'application/json')
      .expect(/Cannot forward/i)
      .end(end)

    function end(err, res) {
      expect(spy.calledOnce).to.be.true
      expect(spy.args[0][0].message).to.match(/Target URL/i)
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)
      done()
    }
  })

  test('timeout', function (done) {
    var spy = sinon.spy()
    var serverSpy = sinon.spy()

    replay = createReplayServer(assertReplay)
    server = createTimeoutServer()

    proxy = rocky()
      .forward(targetUrl)
      .replay(replayUrl)
      .listen(ports.proxy)

    proxy.get('/test')
      .options({ timeout: 50 })
      .on('proxyReq', spy)
      .on('proxy:error', spy)

    supertest(proxyUrl)
      .get('/test')
      .end(end)

    function end(err, res) {
      expect(spy.calledOnce).to.be.true
      expect(serverSpy.calledOnce).to.be.true
      expect(err.code).to.be.equal('ECONNRESET')
      done()
    }

    function assertReplay(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(204)
      serverSpy()
    }
  })

  test('balancer', function (done) {
    var spy = sinon.spy()
    proxy = rocky()

    var server1 = createServer(9893, 200, spy)
    var server2 = createServer(9894, 201, spy)
    var server3 = createServer(9895, 202, spy)

    proxy
      .get('/test')
      .balance([
        'http://localhost:9893',
        'http://localhost:9894',
        'http://localhost:9895'
      ])

    proxy.listen(ports.proxy)

    var count = 0
    request()

    function request() {
      count += 1
      supertest(proxyUrl)
        .get('/test')
        .expect(200 + count)
        .expect('Content-Type', 'application/json')
        .expect({ 'hello': 'world' })
        .end(count === 3 ? assert : request)
    }

    function assert() {
      expect(spy.calledThrice).to.be.true
      done()
    }
  })

  test('connect middleware', function (done) {
    proxy = rocky().forward(targetUrl)
    server = createTestServer(assert)
    proxy.get('/test')

    var app = connect()
      .use(proxy.middleware())
      .listen(ports.proxy)

    supertest(proxyUrl)
      .get('/test')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .expect({ 'hello': 'world' })
      .end(done)

    function assert(req, res) {
      expect(req.url).to.be.equal('/test')
      expect(res.statusCode).to.be.equal(200)
    }
  })

})

function createTestServer(assert) {
  return createServer(ports.target, 200, assert)
}

function createReplayServer(assert) {
  return createServer(ports.replay, 204, assert)
}

function createTimeoutServer(assert) {
  return createServer(ports.target, 503, assert, 30 * 1000)
}

function createServer(port, code, assert, timeout) {
  var server = http.createServer(function (req, res) {
    setTimeout(handler, +timeout || 1)

    function handler() {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ 'hello': 'world' }))

      var body = ''
      req.on('data', function (data) {
        body += data
      })
      req.on('end', function () {
        req.body = body
        end()
      })
    }

    function end() {
      if (assert) assert(req, res)
      res.end()
    }
  })

  server.listen(port)
  return server
}

function randomString(x) {
  var s = ''
  x = +x || 100000
  while (s.length < x && x > 0) {
    var r = Math.random()
    s+= r < 0.1 ? Math.floor(r*100): String.fromCharCode(Math.floor(r*26) + (r>0.5?97:65))
  }
  return s
}
