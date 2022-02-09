# local-proxy-server

一个轻量本地文件代理服务器。  

如果你希望一部分资源获取/API请求根据某种规则映射到本地文件, 那么你需要它  
如果你还希望另外一部分走线上服务, 那么你需要它  

## Usage

``` bash
# 安装
$ npm i -g local-proxy-server

# 默认启动在 3000 端口, 并且加载当前执行目录的 local-proxy-server.conf.js
$ local-proxy-server

# 指定配置文件
$ local-proxy-server -c conf.js
```

## 配置参考

默认加载配置文件为命令执行目录的 `local-proxy-server.conf.js`  

``` javascript
const path = require('path');
const cwd = process.cwd();
const applictionPath = function (...paths) {
  return path.join(cwd, 'application', ...paths);
}
module.exports = {
  server: {
    port: 3003, // 默认监听 3000
    host: '0.0.0.0' // 监听所有网卡, 默认 localhost
  },
  localRules: [
    // 代理 /api/v1 的接口到 application/api/ 下的 json 文件, 映射规则见 filepath
    {
      path: '/api/v1/(.*)',
      filepath: (ctx) => {
        const filepath = `${ctx.method}__${ctx.path.replace(/\//g, '__')}.json`;
        return applictionPath('api', filepath);
      }
    },
    // 映射资源路径到具体文件
    {
      path: '(.*)',
      filepath: (ctx) => {
        const pathFunc = v => application('web', v);
        if (path.extname(ctx.path).length) return pathFunc(ctx.path);
        return pathFunc()
      },
    },
  ],
  // 对于所有没有匹配到映射对目录下的 index.html, 适应 SPA 应用
  historyApiFallback: applictionPath('web'),
  // 可以对部门 API 代理已有的服务上
  proxy: {
    '/api/v2': {
      target: 'https://10.48.73.210:8443',
      changeOrigin: true,
      secure: false
    }
  }
}
```

