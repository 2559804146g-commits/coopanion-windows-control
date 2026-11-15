import Vue from 'vue';
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import VueI18n from 'vue-i18n';
import zh from './i18n/zh_CN';
import ModelConfig from './views/ModelConfig.vue';
import './app.css';
Vue.use(ElementUI);Vue.use(VueI18n);Vue.config.productionTip=false;
new Vue({i18n:new VueI18n({locale:'zh_CN',messages:{zh_CN:zh}}),render:h=>h(ModelConfig)}).$mount('#app');

window.addEventListener('message',e=>{if(e.source!==parent||e.origin!=='http://127.0.0.1:17788'||e.data?.channel!=='ecology-theme')return;for(const [key,value] of Object.entries(e.data.tokens||{}))if(['--page','--sheet','--ink','--ink-soft','--line','--accent','--hover','--danger','--sans'].includes(key)&&typeof value==='string')document.documentElement.style.setProperty(key,value);});
