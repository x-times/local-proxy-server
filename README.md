# local-proxy-server

一个轻量本地文件代理服务器。  

如果你希望一部分资源获取/API请求根据某种规则映射到本地文件, 那么你需要它  
如果你还希望另外一部分走线上服务, 那么你需要它  

## 安装

```
$ npm i -g local-proxy-server
```
## Usage

默认启动在 3000 端口, 并且加载当前执行目录的 local-proxy-server.conf.js:  

``` bash
$ local-proxy-server
```

指定配置文件(**参考配置章节**):  

``` bash
$ local-proxy-server -c conf.js
```

打印调试信息:  

``` bash
$ DEBUG=local-proxy-server local-proxy-server
```
## 配置

默认加载配置文件为命令执行目录的 `local-proxy-server.conf.js`  

参考配置示例 [example/conf.js](./example/conf.js)  

**配置选项说明**:  

* `server`:
  * `port`: 服务端口, 默认 3000
  * `host`: 服务地址, 默认 localhost。指定 `0.0.0.0` 可以监听所有网卡。  

* `localRules`: 数组, 指定多组本地代理规则  
  * `rule.path`: 指定匹配规则, 符合 `koa`路径匹配规则  
  * `rule.filepath(ctx): string | string[]`: 本地映射规则, 类型为函数, 接受 koa ctx, 返回后的本地文件绝对路径  

* `historyApiFallback`: 适应 SPA 应用, 针对没有匹配到的请求指定本地映射路径  

* `proxy`: 指定接口代理服务规则, 符合 [webpack-dev-server 指定的 proxy 规则](https://webpack.docschina.org/configuration/dev-server/#devserverproxy)  

* `cache`: `function | Object`, 代理缓存策略, 具体看 [代理缓存] 章节  

## 代理缓存

如果设置 `cache`, 则会执行缓存策略进行请求缓存相应以及相应缓存, 具体执行取决于指定的缓存策略  

目前允许两种方式指定缓存策略:

1. 代理缓存函数  
2. 代理缓存对象
## 代理缓存函数

缓存函数原型:  

```
// 返回缓存地址
({stage, req}) => string;
```

当设置缓存函数, 则代理请求会进行缓存以及响应:  

1. 当请求发生的时候, 如果能命中缓存, 则直接返回缓存;   
2. 如果不能命中, 则请求代理服务, 缓存服务结果, 返回响应值;  

`cache` 是根据请求返回数据缓存路径, 因此命中缓存以及缓存响应的都是利用 `cache` 的返回结果。  

## 代理缓存对象  

```
{
  matchCacheFilepath: ({req, stage}) => [] | string,
  cacheFilepath: ({req, stage}) => string
}
```
