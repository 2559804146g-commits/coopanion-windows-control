<template>
  <CustomDialog :visible.sync="localVisible" :title="$t('modelConfig.voiceManagement')" width="90%"
    :close-on-click-modal="false" :destroy-on-close="false" :footer="false" :append-to-body="true"
    @close="handleClose">
    <div class="voice-toolbar">
      <span>已配置 {{ ttsModels.length }} 个音色</span>
      <el-select v-if="isBreeze" v-model="syncLanguage" :disabled="syncing" aria-label="加载音色的语言" style="width:130px"><el-option label="中文音色" value="zh"/><el-option label="全部语言" value=""/></el-select>
      <el-button v-if="isBreeze" :loading="syncing" :disabled="loading" @click="syncVoices">从账号加载音色</el-button>
      <el-input v-model="searchQuery" placeholder="搜索音色名称" clearable aria-label="搜索音色名称" style="width:220px" />
    </div>
    <p class="voice-help">勾选常用音色后点击保存，才会出现在「生态与声音」下拉框。当前使用的声音会保留。{{ isBreeze ? '试听会使用账号额度。' : '' }}</p>
    <div class="voice-selection-bar">
      <span role="status">已勾选 {{ selectedCount }} 个<span v-if="selectionDirty"> · 尚未保存</span></span>
      <el-checkbox v-model="onlySelected">只看已勾选</el-checkbox>
      <el-button size="small" :disabled="loading || savingSelection || syncing" @click="toggleSelectAll">{{ allVisibleSelected ? '取消勾选搜索结果' : '勾选全部搜索结果' }}</el-button>
      <el-button type="primary" size="small" :loading="savingSelection" :disabled="!selectionDirty || loading || syncing" @click="saveQuickVoices">保存常用音色</el-button>
    </div>
    <div class="scroll-wrapper">
      <div class="table-container" ref="tableContainer" @scroll="handleScroll">
        <el-table v-loading="loading" :data="filteredTtsModels" row-key="id" style="width: 100%;" class="data-table"
          header-row-class-name="table-header" :fit="true" :element-loading-text="$t('voicePrint.loading')"
          element-loading-spinner="el-icon-loading" element-loading-background="rgba(0, 0, 0, 0.8)">
          <el-table-column label="常用" width="52" align="center">
            <template slot-scope="scope">
              <el-checkbox v-model="scope.row.selected" :disabled="scope.row.isCurrent || !scope.row.id || savingSelection" :aria-label="'将'+scope.row.voiceName+'加入常用音色'"></el-checkbox>
            </template>
          </el-table-column>
          <el-table-column :label="$t('ttsModel.voiceCode')" width="100" align="center">
            <template slot-scope="scope">
              <el-input v-if="scope.row.editing" v-model="scope.row.voiceCode"></el-input>
              <span v-else class="voice-code" :title="scope.row.voiceCode">{{ scope.row.voiceCode }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('ttsModel.voiceName')" min-width="120" align="center">
            <template slot-scope="scope">
              <el-input v-if="scope.row.editing" v-model="scope.row.voiceName"></el-input>
              <span v-else>{{ scope.row.voiceName }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('ttsModel.languageType')" width="64" align="center">
            <template slot-scope="scope">
              <el-input v-if="scope.row.editing" v-model="scope.row.languageType"></el-input>
              <span v-else>{{ scope.row.languageType }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="!showReferenceColumns && hasPreviews" :label="$t('ttsModel.preview')" align="center" class-name="audio-column">
            <template slot-scope="scope">
              <div class="custom-audio-container">
                <el-input v-if="scope.row.editing" v-model="scope.row.voiceDemo" :placeholder="$t('ttsModel.enterMp3Url')"
                  class="audio-input">
                </el-input>
                <AudioPlayer v-else-if="isValidAudioUrl(scope.row.voiceDemo)" :audioUrl="scope.row.voiceDemo" />
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="!showReferenceColumns" :label="$t('ttsModel.remark')" align="center">
            <template slot-scope="scope">
              <el-input v-if="scope.row.editing" type="textarea" :rows="1" autosize v-model="scope.row.remark"
                  :placeholder="$t('ttsModel.enterRemark')" class="remark-input"></el-input>
              <span v-else class="voice-remark" :title="scope.row.remark">{{ scope.row.remark }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showReferenceColumns" :label="$t('ttsModel.referenceAudioPath')" align="center">
            <template slot-scope="scope">
              <el-input v-if="scope.row.editing" v-model="scope.row.referenceAudio" :placeholder="$t('ttsModel.enterReferenceAudio')"></el-input>
              <span v-else>{{ scope.row.referenceAudio }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showReferenceColumns" :label="$t('ttsModel.referenceText')" align="center">
            <template slot-scope="scope">
              <el-input v-if="scope.row.editing" v-model="scope.row.referenceText" :placeholder="$t('ttsModel.enterReferenceText')"></el-input>
              <span v-else>{{ scope.row.referenceText }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('ttsModel.operation')" align="center" width="160">
            <template slot-scope="scope">
              <template v-if="!scope.row.editing">
                <el-button type="text" size="mini" @click="previewVoice(scope.row)">试听</el-button>
                <el-button type="text" size="mini" :disabled="scope.row.isCurrent" @click="useVoice(scope.row)">{{ scope.row.isCurrent ? '当前使用' : '选用' }}</el-button>
                <el-button v-if="!scope.row.builtIn" type="text" size="mini" @click="startEdit(scope.row)" class="edit-btn">
                    {{ $t('ttsModel.edit') }}
                  </el-button>
                  <el-button v-if="!scope.row.builtIn && !scope.row.isCurrent" type="text" size="mini" @click="deleteRow(scope.row)" class="delete-btn">
                    {{ $t('ttsModel.delete') }}
                  </el-button>
              </template>
              <template v-else>
                <el-button type="success" size="mini" @click="cancelEdit(scope.row)" class="save-Tts">
                  {{ $t('button.cancel') }}
                </el-button>
                <el-button type="success" size="mini" @click="saveEdit(scope.row)" class="save-Tts">
                  {{ $t('ttsModel.save') }}
                </el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 自定义滚动条 -->
      <div class="custom-scrollbar" ref="scrollbar">
        <div class="custom-scrollbar-track" ref="scrollbarTrack" @click="handleTrackClick">
          <div class="custom-scrollbar-thumb" ref="scrollbarThumb" @mousedown="startDrag"></div>
        </div>
      </div>
    </div>
    <div class="action-buttons">
      <CustomButton v-if="!isLocal" icon="el-icon-plus" size="small" type="add" @click="addNew">
        {{ $t('ttsModel.add') }}
      </CustomButton>
    </div>
  </CustomDialog>
</template>

<script>
import Api from "@/apis/api";
import AudioPlayer from './AudioPlayer.vue';
import CustomDialog from './CustomDialog.vue';
import CustomButton from './CustomButton.vue';

export default {
  components: { AudioPlayer, CustomDialog, CustomButton },
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    ttsModelId: {
      type: String,
      required: true
    },
    modelConfig: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      localVisible: this.visible,
      searchQuery: '',
      editDialogVisible: false,
      editVoiceData: {},
      ttsModels: [],
      currentPage: 1,
      pageSize: 10000,
      total: 0,
      isDragging: false,
      startY: 0,
      scrollTop: 0,
      selectAll: false,
      selectedRows: [],
      loading: false,
      syncing: false,
      syncLanguage: 'zh',
      savingSelection: false,
      onlySelected: false,
      showReferenceColumns: false, // 控制是否显示参考列
    };
  },
  watch: {
    visible(newVal) {
      this.localVisible = newVal;
      if (newVal) {
        this.currentPage = 1;
        this.updateShowReferenceColumns(); // 更新显示状态
        this.loadData(); // 对话框显示时加载数据
        this.$nextTick(() => {
          this.updateScrollbar();
        });
      }
    },
    modelConfig: {
      handler(newVal) {
        this.updateShowReferenceColumns();
      },
      immediate: true
    },
    filteredTtsModels() {
      this.$nextTick(() => {
        this.updateScrollbar();
      });
    }
  },
  computed: {
    isBreeze() { return this.modelConfig?.configJson?.type === 'breezeblue'; },
    isLocal() { return this.modelConfig?.configJson?.type === 'local'; },
    hasPreviews() { return this.ttsModels.some(row=>this.isValidAudioUrl(row.voiceDemo)); },
    selectedCount() { return this.ttsModels.filter(row=>row.selected).length; },
    selectionDirty() { return this.ttsModels.some(row=>row.id && row.selected!==row.savedSelected); },
    allVisibleSelected() { return this.filteredTtsModels.length>0 && this.filteredTtsModels.every(row=>row.selected); },
    filteredTtsModels() {
      return this.ttsModels.filter(model =>
        model.voiceName.toLowerCase().includes(this.searchQuery.toLowerCase()) && (!this.onlySelected || model.selected)
      );
    }
  },
  mounted() {
    this.updateScrollbar();
    window.addEventListener('resize', this.updateScrollbar);
    window.addEventListener('mouseup', this.stopDrag);
    window.addEventListener('mousemove', this.handleDrag);
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.updateScrollbar);
    window.removeEventListener('mouseup', this.stopDrag);
    window.removeEventListener('mousemove', this.handleDrag);
  },
  methods: {
    async saveQuickVoices() {
      if(this.savingSelection)return;
      if(this.ttsModels.some(row=>row.editing)){this.$message.warning('请先保存或取消正在编辑的音色');return;}
      this.savingSelection=true;
      try{const result=await Api.saveQuickVoices(this.ttsModelId,this.ttsModels.filter(row=>row.selected).map(row=>row.id));
        for(const row of this.ttsModels){row.selected=result.voiceIds.includes(row.id);row.savedSelected=row.selected;}
        this.$message.success('常用音色已保存，声音下拉框已更新');
      }catch(e){this.$message.error(e.message);}finally{this.savingSelection=false;}
    },
    async syncVoices() {
      if(this.syncing)return;
      if(this.ttsModels.some(row=>row.editing)){this.$message.warning('请先保存或取消正在编辑的音色');return;}
      this.syncing=true;
      try{const r=await Api.syncVoices(this.ttsModelId,this.syncLanguage);this.$message.success('已加载 '+r.total+' 个'+(this.syncLanguage==='zh'?'中文':'')+'音色');this.loadData(true);}
      catch(e){this.$message.error(e.message);}
      finally{this.syncing=false;}
    },
    async previewVoice(row) { try { await Api.preview(this.ttsModelId,row.voiceCode); } catch(e) { this.$message.error(e.message); } },
    async useVoice(row) { try { await Api.useVoice(row.id); this.loadData(true);this.$message.success('已设为当前桌宠的声音'); } catch(e) { this.$message.error(e.message); } },
    // 更新是否显示参考列
    updateShowReferenceColumns() {
      if (this.modelConfig && this.modelConfig.configJson) {
        const providerType = this.modelConfig.configJson.type;
        this.showReferenceColumns = ['fishspeech', 'gpt_sovits_v2', 'gpt_sovits_v3'].includes(providerType);
      } else {
        this.showReferenceColumns = false;
      }
    },

    loadData(preserveSelection=false) {
      const draft=preserveSelection?new Map(this.ttsModels.filter(row=>row.id).map(row=>[row.id,row.selected])):new Map();
      this.loading = true;
      const params = {
        ttsModelId: this.ttsModelId,
        page: this.currentPage,
        limit: this.pageSize,
        name: this.searchQuery
      };
      Api.timbre.getVoiceList(params, (data) => {
        if (data.code === 0) {
          this.ttsModels = data.data.list
            .map(item => ({
              id: item.id || '',
              voiceCode: item.ttsVoice || '',
              voiceName: item.name || this.$t('ttsModel.unnamedVoice'),
              languageType: item.languages || '',
              remark: item.remark || '',
              referenceAudio: item.referenceAudio || '',
              referenceText: item.referenceText || '',
              voiceDemo: item.voiceDemo || '',
              selected: item.isCurrent || (draft.has(item.id)?draft.get(item.id):!!item.quickSelected),
              savedSelected: !!item.quickSelected,
              isCurrent: !!item.isCurrent,
              builtIn: !!item.builtIn,
              editing: false,
              sort: Number(item.sort)
            }))
            .sort((a, b) => a.sort - b.sort);
          this.total = data.total;
        } else {
          this.$message.error({
            message: data.msg || this.$t('ttsModel.getVoiceListFailed'),
            showClose: true
          });
        }
        this.loading = false;
      }, (err) => {
        console.error('加载失败:', err);
        this.$message.error({
          message: this.$t('ttsModel.loadVoiceDataFailed'),
          showClose: true
        });
        this.loading = false;
      });
    },

    handleClose() {
      // 重置状态
      this.ttsModels = [];
      this.currentPage = 1;
      this.total = 0;
      this.selectAll = false;
      this.searchQuery = '';
      this.onlySelected = false;
      this.showReferenceColumns = false;

      this.localVisible = false;
      this.$emit('update:visible', false);
    },

    updateScrollbar() {
      const container = this.$refs.tableContainer;
      const scrollbarThumb = this.$refs.scrollbarThumb;
      const scrollbarTrack = this.$refs.scrollbarTrack;

      if (!container || !scrollbarThumb || !scrollbarTrack) return;

      const { scrollHeight, clientHeight } = container;
      const trackHeight = scrollbarTrack.clientHeight;
      const thumbHeight = Math.max((clientHeight / scrollHeight) * trackHeight, 20);

      scrollbarThumb.style.height = `${thumbHeight}px`;
      this.updateThumbPosition();
    },

    updateThumbPosition() {
      const container = this.$refs.tableContainer;
      const scrollbarThumb = this.$refs.scrollbarThumb;
      const scrollbarTrack = this.$refs.scrollbarTrack;

      if (!container || !scrollbarThumb || !scrollbarTrack) return;

      const { scrollHeight, clientHeight, scrollTop } = container;
      const trackHeight = scrollbarTrack.clientHeight;
      const thumbHeight = scrollbarThumb.clientHeight;
      const maxTop = trackHeight - thumbHeight;
      const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * (trackHeight - thumbHeight);

      scrollbarThumb.style.top = `${Math.min(thumbTop, maxTop)}px`;
    },

    handleScroll() {
      const container = this.$refs.tableContainer;
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
        if (this.currentPage * this.pageSize < this.total) {
          this.currentPage++;
          this.loadData();
        }
      }
      this.updateThumbPosition();
    },

    startDrag(e) {
      this.isDragging = true;
      this.startY = e.clientY;
      this.scrollTop = this.$refs.tableContainer.scrollTop;
      e.preventDefault();
    },

    stopDrag() {
      this.isDragging = false;
    },

    handleDrag(e) {
      if (!this.isDragging) return;

      const container = this.$refs.tableContainer;
      const scrollbarTrack = this.$refs.scrollbarTrack;
      const scrollbarThumb = this.$refs.scrollbarThumb;
      const deltaY = e.clientY - this.startY;
      const trackHeight = scrollbarTrack.clientHeight;
      const thumbHeight = scrollbarThumb.clientHeight;
      const maxScrollTop = container.scrollHeight - container.clientHeight;

      const scrollRatio = (trackHeight - thumbHeight) / maxScrollTop;
      container.scrollTop = this.scrollTop + deltaY / scrollRatio;
    },

    handleTrackClick(e) {
      const container = this.$refs.tableContainer;
      const scrollbarTrack = this.$refs.scrollbarTrack;
      const scrollbarThumb = this.$refs.scrollbarThumb;

      if (!container || !scrollbarTrack || !scrollbarThumb) return;

      const trackRect = scrollbarTrack.getBoundingClientRect();
      const thumbHeight = scrollbarThumb.clientHeight;
      const clickPosition = e.clientY - trackRect.top;
      const thumbCenter = clickPosition - thumbHeight / 2;

      const trackHeight = scrollbarTrack.clientHeight;
      const maxTop = trackHeight - thumbHeight;
      const newTop = Math.max(0, Math.min(thumbCenter, maxTop));

      scrollbarThumb.style.top = `${newTop}px`;
      container.scrollTop = (newTop / (trackHeight - thumbHeight)) * (container.scrollHeight - container.clientHeight);
    },

    startEdit(row) {
      row.editing = true;
      this.$set(row, 'originalData', { ...row });
    },

    cancelEdit(row) {
      // 通过新增创建的数据，取消编辑时，需要从数组中移除
      if (!row.id) {
        this.ttsModels.shift(row);
      } else {
        Object.assign(row, row.originalData);
        delete row.originalData;
      }
      row.editing = false;
    },

    saveEdit(row) {
      if (!row.voiceCode || !row.voiceName || !row.languageType) {
        this.$message.error({
          message: this.$t('ttsModel.voiceCodeNameLanguageRequired'),
          showClose: true
        });
        return;
      }

      try {
        const params = {
          id: row.id,
          voiceCode: row.voiceCode,
          voiceName: row.voiceName,
          languageType: row.languageType,
          remark: row.remark,
          ttsModelId: this.ttsModelId,
          voiceDemo: row.voiceDemo || '',
          sort: row.sort
        };

        // 只有在显示参考列的情况下才添加参考字段
        if (this.showReferenceColumns) {
          params.referenceAudio = row.referenceAudio;
          params.referenceText = row.referenceText;
        }

        let res;
        if (row.id) {
          // 已有ID，执行更新操作
          Api.timbre.updateVoice(params, (response) => {
            res = response;
            this.handleResponse(res, row);
          });
        } else {
          // 没有ID，执行新增操作
          Api.timbre.saveVoice(params, (response) => {
            res = response;
            this.handleResponse(res, row);
          });
        }
      } catch (error) {
        console.error('操作失败:', error);
        // 异常情况下也恢复原始数据
        if (row.originalData) {
          Object.assign(row, row.originalData);
          row.editing = false;
          delete row.originalData;
        }
        this.$message.error({
          message: this.$t('ttsModel.operationFailed'),
          showClose: true
        });
      }
    },

    handleResponse(res, row) {
      if (res.code === 0) {
        this.$message.success({
          message: row.id ? this.$t('ttsModel.updateSuccess') : this.$t('ttsModel.saveSuccess'),
          showClose: true
        });
        row.editing = false;
        delete row.originalData;
        this.loadData(true); // Keep unsaved favourite choices while editing metadata.
      } else {
        // 保存失败时恢复原始数据
        if (row.originalData) {
          Object.assign(row, row.originalData);
          row.editing = false;
          delete row.originalData;
        }
        this.$message.error({
            message: res.msg || (row.id ? this.$t('ttsModel.updateFailed') : this.$t('ttsModel.saveFailed')),
            showClose: true
          });
      }
    },

    toggleSelectAll() {
      const checked = !this.allVisibleSelected;
      this.filteredTtsModels.forEach(row => {
        if(row.id && !row.isCurrent)row.selected = checked;
      });
    },

    addNew() {
      const hasEditing = this.ttsModels.some(row => row.editing);
      if (hasEditing) {
        this.$message.warning(this.$t('ttsModel.finishEditingFirst'));
        return;
      }

      const maxSort = this.ttsModels.length > 0
        ? Math.max(...this.ttsModels.map(item => Number(item.sort) || 0))
        : 0;

      const newRow = {
        voiceCode: '',
        voiceName: '',
        languageType: this.$t('editVoiceDialog.defaultLanguageType'),
        voiceDemo: '',
        remark: '',
        referenceAudio: '',
        referenceText: '',
        selected: false,
        editing: true,
        sort: 0 // 新增数据默认排序在顶部
      };

      this.ttsModels.unshift(newRow);
    },

    deleteRow(row) {
      // 处理单个音色或音色数组
      const voices = Array.isArray(row) ? row : [row];

      if (Array.isArray(row) && row.length === 0) {
        this.$message.warning(this.$t('ttsModel.selectVoiceToDelete'));
        return;
      }


      const voiceCount = voices.length;
      this.$confirm(this.$t('ttsModel.confirmDeleteVoice', {count: voiceCount}), this.$t('ttsModel.warning'), {
        confirmButtonText: this.$t('common.confirm'),
        cancelButtonText: this.$t('common.cancel'),
        type: "warning",
        distinguishCancelAndClose: true
      }).then(() => {
        const ids = voices.map(voice => voice.id);
        if (ids.some(id => !id)) {
          this.$message.error(this.$t('ttsModel.invalidVoiceId'));
          return;
        }

        Api.timbre.deleteVoice(ids, ({ data }) => {
          if (data.code === 0) {
            this.$message.success({
              message: this.$t('ttsModel.deleteVoiceSuccess', {count: voiceCount}),
              showClose: true
            });
            this.loadData(true);
          } else {
            this.$message.error({
              message: data.msg || this.$t('ttsModel.deleteFailed'),
              showClose: true
            });
          }
        });
      }).catch(action => {
        if (action === 'cancel') {
          this.$message({
            type: 'info',
            message: this.$t('ttsModel.deleteCancelled'),
            duration: 1000
          });
        } else {
          this.$message({
            type: 'info',
            message: this.$t('ttsModel.operationClosed'),
            duration: 1000
          });
        }
      });
    },

    isValidAudioUrl(url) {
      return url && (url.endsWith('.mp3') || url.endsWith('.ogg') || url.endsWith('.wav'));
    }
  }
};
</script>

