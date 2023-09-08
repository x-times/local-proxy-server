const path = require('path');
const Koa = require('koa');
const koaBody = require('koa-body');
const pkg = require('../package.json');
const debug = require('debug')(pkg.name);
const { pathToRegexp } = require("path-to-regexp");
const fs = require('fs')
const fse = require('fs-extra')
const os = require('os')
const util = require('util')
const c2k = require('koa2-connect')
const createError = require('http-errors')
const { createProxyMiddleware, fixRequestBody, responseInterceptor } = require('http-proxy-middleware');

const argv = require('minimist')(process.argv.slice(2));
const confFile = parseConfFilepath(argv.c);
const defaultConf = {
  server: {
    port: '3000'
  }
};

const { localRules, server, proxy, historyApiFallback, cache } = fs.existsSync(confFile) ?require(confFile) : defaultConf;

const app = new Koa();

// 代理服务本不需要解析 body, 但是因为后续缓存功能需要依赖 query/body 定义缓存规则
// 在 proxy 之前加上 koa-body 中间件, 会导致提前消费 http stream, 最终导致代理异常
// 为了解决这个问题, 需要在代理前的 onProxyReq 中恢复 request stream
app.use(koaBody());

// 代理文件到本地文件
if (localRules) {
  proxyLocal(app, localRules)
}

// 代理到服务器
if (proxy) {
  proxyService(app, proxy)
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
  // 添加 query, body 参数便于 proxy 中使用, 比如下面 onProxyReq 中恢复 request stream
  app.use(async (ctx, next) => {
    ctx.req.koaRequest = ctx.request;
    ctx.req.query = ctx.request.query;
    ctx.req.body = ctx.request.body;
    await next();
  });

  const flatProxy = (originProxy) => {
    let proxy = originProxy
    if (originProxy.length) {
      proxy = {}
      originProxy.forEach(({context, ...proxyConf}) => {
        context.forEach(ctx => {
          proxy[ctx] = proxyConf
        })
      })
    }
    return proxy
  }
  proxy = flatProxy(proxy)

  if (cache) {
    const matchCacheFilepath = typeof cache === 'function' ? cache : cache.matchCacheFilepath;
    app.use(async (ctx, next) => {
      // keep same with this: https://github.com/chimurai/http-proxy-middleware/blob/cb466286e83782e868df966cd687a656df7a91f2/src/context-matcher.ts#L46
      const matchContext = Object.keys(proxy).some(context => ctx.path.indexOf(context) === 0);
      if (!matchContext) {
        return await next();
      }
      const { request, res} = ctx;
      let filepaths = matchCacheFilepath({req: request, res, stage: 'hit'}); 
      filepaths = typeof filepaths === 'string' ?  [filepaths] : filepaths || [];
      const filepath = filepaths.find(filepath => fse.pathExistsSync(filepath));
      if (filepath) {
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

  for (const api of Object.keys(proxy)) {
    let currentProxy = proxy[api];
    if (typeof currentProxy === 'string') {
      currentProxy = {
        target: currentProxy
      };
    }
    currentProxy.onProxyReq = (proxyReq, req, res) => {
      // 依赖 req.body, koa 需要自行中间件添加
      fixRequestBody(proxyReq, req);
    };

    if (cache) {
      const cacheFilepath = typeof cache === 'function' ? cache : cache.cacheFilepath;
      Object.assign(currentProxy, {
        selfHandleResponse: true,
        onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
          const response = responseBuffer.toString('utf8'); // convert buffer to string
          const filepath = cacheFilepath({req: req.koaRequest, res, stage: 'cache'}); 
          if (filepath) {
            fse.ensureFileSync(filepath);
            fs.writeFileSync(filepath, response);
          }
          return responseBuffer;
        })
      });
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
      let filepaths = match.filepath(ctx);
      filepaths = typeof filepaths === 'string' ?  [filepaths] : filepaths || [];
      const filepath = filepaths.find(filepath => fse.pathExistsSync(filepath));
      if (!filepath) return await next();
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
