<template>
  <div class="pagination-wrapper">
    <el-pagination
      :current-page="currentPage"
      :page-size="pageSize"
      :page-sizes="pageSizeOptions"
      :total="total"
      layout="sizes, prev, pager, next, total"
      background
      @size-change="handleSizeChange"
      @current-change="handlePageChange"
    />
  </div>
</template>

<script>
export default {
  name: 'Pagination',
  props: {
    total: {
      type: Number,
      default: 0
    },
    currentPage: {
      type: Number,
      default: 1
    },
    pageSize: {
      type: Number,
      default: 10
    },
    pageSizeOptions: {
      type: Array,
      default: () => [10, 20, 50, 100]
    }
  },
  methods: {
    handleSizeChange(val) {
      this.$emit('size-change', val);
    },
    handlePageChange(page) {
      this.$emit('page-change', page);
    }
  }
};
</script>


