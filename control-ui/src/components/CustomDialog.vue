<template>
  <el-dialog
    :title="title"
    :visible.sync="dialogVisible"
    :width="width"
    :close-on-click-modal="closeOnClickModal"
    :close-on-press-escape="closeOnPressEscape"
    :show-close="showClose"
    :destroy-on-close="destroyOnClose"
    :custom-class="customClass"
    class="custom-dialog"
    @close="handleClose"
    @open="handleOpen"
  >
    <template slot="title">
      <slot name="title">
        <div class="dialog-title">
          
          <span>{{ title }}</span>
        </div>
      </slot>
    </template>
    <slot></slot>
    <template slot="footer">
      <div v-if="footer" class="dialog-footer">
        <CustomButton @click="handleCancel">{{ cancelText }}</CustomButton>
        <CustomButton :loading="confirmLoading" type="confirm" @click="handleConfirm">
          <span class="confirm-inner">
            
            {{ confirmText }}
          </span>
        </CustomButton>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import CustomButton from './CustomButton.vue';
export default {
  name: "CustomDialog",
  props: {
    title: {
      type: String,
      default: ""
    },
    visible: {
      type: Boolean,
      default: false
    },
    confirmLoading: {
      type: Boolean,
      default: false
    },
    width: {
      type: String,
      default: "600px"
    },
    footer: {
      type: Boolean,
      default: true
    },
    closeOnClickModal: {
      type: Boolean,
      default: false
    },
    closeOnPressEscape: {
      type: Boolean,
      default: true
    },
    showClose: {
      type: Boolean,
      default: true
    },
    destroyOnClose: {
      type: Boolean,
      default: true
    },
    customClass: {
      type: String,
      default: ""
    },
    cancelText: {
      type: String,
      default: "取消"
    },
    confirmText: {
      type: String,
      default: "确认保存"
    }
  },
  data() {
    return {
      dialogVisible: this.visible
    };
  },
  components: {
    CustomButton
  },
  watch: {
    visible(val) {
      this.dialogVisible = val;
    }
  },
  methods: {
    handleClose() {
      this.dialogVisible = false;
      this.$emit("update:visible", false);
      this.$emit("close");
    },
    handleOpen() {
      this.$emit("open");
    },
    handleCancel() {
      this.dialogVisible = false;
      this.$emit("update:visible", false);
      this.$emit("cancel");
    },
    handleConfirm() {
      this.$emit("confirm");
    }
  }
};
</script>


