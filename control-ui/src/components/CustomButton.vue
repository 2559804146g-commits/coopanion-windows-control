<template>
  <el-button
    :class="['custom-button', `custom-button--${type}`]"
    v-bind="$attrs"
    @click="$emit('click', $event)"
  >
    <slot />
  </el-button>
</template>

<script>
export default {
  name: 'CustomButton',
  props: {
    type: {
      type: String,
      default: 'default',
      validator: (val) => ['default', 'confirm', 'delete', 'add'].includes(val)
    }
  }
};
</script>


