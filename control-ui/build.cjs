const path=require('node:path'),{createRequire}=require('node:module');
// Prefer this package's locked dependencies. The fallback only supports the existing local checkout.
const fs=require('node:fs');
const upstream=fs.existsSync(path.join(__dirname,'node_modules/@vue/cli-service/package.json'))?__dirname:path.resolve(__dirname,'../../../xiaozhi-esp32-server-0.9.6/main/manager-web');
const req=createRequire(path.join(upstream,'package.json')),Service=req('@vue/cli-service/lib/Service');
process.env.NODE_PATH=path.join(upstream,'node_modules');require('node:module').Module._initPaths();
const service=new Service(__dirname,{pkg:{name:'ecology-zhikong-voice-ui',version:'0.8.1',dependencies:{'vue':'^2.6.14'},devDependencies:{'@vue/cli-service':'~5.0.0'}},inlineOptions:{publicPath:'./',productionSourceMap:false,parallel:false,configureWebpack:{resolve:{alias:{'@':path.join(__dirname,'src')},modules:[path.join(upstream,'node_modules'),'node_modules']},resolveLoader:{modules:[path.join(upstream,'node_modules'),'node_modules']}}}});
service.run('build',{dest:path.resolve(__dirname,'../bridge/control-ui'),mode:'production'}).catch(e=>{console.error(e.message);process.exitCode=1;});
