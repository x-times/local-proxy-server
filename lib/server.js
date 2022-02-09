const path = require('path');
const Koa = require('koa');
const koaBody = require('koa-body');
const pkg = require('../package.json');
const debug = require('debug')(pkg.name);
const { pathToRegexp } = require("path-to-regexp");
const fs = require('fs')
const os = require('os')
const util = require('util')
const c2k = require('koa2-connect')
const createError = require('http-errors')
const { createProxyMiddleware } = require('http-proxy-middleware');

const argv = require('minimist')(process.argv.slice(2));
const confFile = parseConfFilepath(argv.c);
const defaultConf = {
  server: {
    port: '3000'
  }
};

const { localRules, server, proxy, historyApiFallback } = fs.existsSync(confFile) ?require(confFile) : defaultConf;

const app = new Koa();

// 代理到服务器
if (proxy) {
  proxyService(app, proxy)
}

// 在代理服务之后解析 body, 否则解析后 body 被代理服务无法识别引发接口请求错误
app.use(koaBody());

// 代理文件到本地文件
if (localRules) {
  proxyLocal(app, localRules)
}

if (historyApiFallback) {
  console.log(`History mode Enabled: ${historyApiFallback}`)
  let index = path.extname(historyApiFallback).length ? '' : `index.html`;
  app.use(async (ctx, next) => {
    return await sendFile(ctx, historyApiFallback, { index });
  });
}

const port = server.port;
const host = server.host || '127.0.0.1';
app.listen(port, host, async (err) => {
  if (err) throw err
  let ip = host;
  if (host === '0.0.0.0') {
    console.log('Listen all interface');
    ip = getAllInterfaces()[0].ip;
  }
  console.log(`You can visit http://${ip}:${port}`)
});


function proxyService(app, proxy) {
  for (const api of Object.keys(proxy)) {
    let currentProxy = proxy[api];
    if (typeof currentProxy === 'string') {
      currentProxy = {
        target: currentProxy
      };
    }
    app.use(c2k(createProxyMiddleware(api, currentProxy)));
  }
}

function proxyLocal(app, localRules) {
  localRules.forEach(rule => rule.pathReg = pathToRegexp(rule.path));
  app.use(async (ctx, next) => {
    const { path } = ctx.request;
    const match = localRules.find(({pathReg}) => pathReg.test(path));
    if (match) {
      const filepath = match.filepath(ctx);
      debug(`Local proxy matched: ${path} => ${filepath}`);
      return await sendFile(ctx, filepath)
        .catch((er) => {
          if (er.code === 'ENOENT' && er.status === 404) {
            ctx.status = 404
            ctx.body = 'Not Found'
          }
        })
    }
    await next();
  });
}

function parseConfFilepath(conf = './local-proxy-server.conf.js') {
  if (path.isAbsolute(conf)) {
    return conf;
  }
  return path.join(process.cwd(), conf);
}

/**
 * 获取当前机器所有网卡的IP
 * @returns {Array} 网卡列表
 */
function getAllInterfaces() {
  const nets = os.networkInterfaces();
  const results = [];
  
  for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
          // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
          if (net.family === 'IPv4' && !net.internal) {
              if (!results[name]) {
                  results[name] = [];
              }
              results.push({
                name,
                ip: net.address
              });
          }
      }
  }
  return results;
}

/**
 * 发送静态文件
 * @param {*} ctx 
 * @param {*} filepath 
 * @param {*} param2 
 * @returns 
 */
async function sendFile(ctx, filepath, { index, maxAge = 0, immutable = false } = {}) {
  const stat = util.promisify(fs.stat);
  let stats
  try {
    stats = await stat(filepath)

    // Format the path to serve static file servers
    // and not require a trailing slash for directories,
    // so that you can do both `/directory` and `/directory/`
    if (stats.isDirectory()) {
      if (index) {
        filepath += `/${index}`
        stats = await stat(filepath)
      } else {
        return next();
      }
    }
  } catch (err) {
    const notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR']
    if (notfound.includes(err.code)) {
      throw createError(404, err)
    }
    err.status = 500
    throw err
  }

  ctx.set('Content-Length', stats.size);
  if (!ctx.response.get('Last-Modified')) ctx.set('Last-Modified', stats.mtime.toUTCString())
  if (!ctx.response.get('Cache-Control')) {
    const directives = [`max-age=${(maxAge / 1000 | 0)}`]
    if (immutable) {
      directives.push('immutable')
    }
    ctx.set('Cache-Control', directives.join(','))
  }
  if (!ctx.type) ctx.type = path.extname(filepath)
  ctx.body = fs.createReadStream(filepath)
}