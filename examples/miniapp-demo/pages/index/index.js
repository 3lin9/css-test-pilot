Page({
  data: { orderId: '' },
  submit() {
    // 调用 mock 业务后端真实下单;urlCheck 关闭后本地地址可用
    wx.request({
      url: 'http://127.0.0.1:8080/api/orders',
      method: 'POST',
      success: (res) => {
        this.setData({ orderId: res.data.id })
      },
    })
  },
})
