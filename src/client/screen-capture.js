async function captureFrame() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('当前浏览器无法截取屏幕，请用电脑上的 Chrome 或 Edge，或通过「选择截图」上传。')
  }
  let stream
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    video.srcObject = stream
    await video.play()
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('没有读到屏幕画面，请重新截图。')), 8000)
      const ready = () => {
        clearTimeout(timer)
        resolve()
      }
      if (video.readyState >= 2) ready()
      else if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(ready)
      else video.addEventListener('loadeddata', ready, { once: true })
    })
    if (!video.videoWidth || !video.videoHeight) throw new Error('没有读到屏幕画面，请重新截图。')
    const frame = document.createElement('canvas')
    frame.width = video.videoWidth
    frame.height = video.videoHeight
    frame.getContext('2d').drawImage(video, 0, 0)
    return frame
  } finally {
    stream?.getTracks().forEach(track => track.stop())
    video.pause()
    video.srcObject = null
  }
}

const captureButton = (action, text, style = 'btn') =>
  `<button type="button" class="${style}" data-capture-action="${action}">${text}</button>`

export async function captureScreenshot(options) {
  let frame
  try {
    frame = await captureFrame()
  } catch (error) {
    if (['NotAllowedError', 'AbortError'].includes(error.name)) return
    if (error.name === 'NotReadableError') throw new Error('当前窗口无法被截取，请重新选择窗口或屏幕。')
    throw error
  }
  showScreenshot(frame, options)
}

export async function pasteScreenshot(file, options) {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('图片须大于 0 且不超过 10 MB。')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取这张图片，请选择 PNG、JPEG 或 WebP 格式的图片。') })
  const frame = document.createElement('canvas')
  try {
    frame.width = bitmap.width
    frame.height = bitmap.height
    frame.getContext('2d').drawImage(bitmap, 0, 0)
  } finally {
    bitmap.close()
  }
  showScreenshot(frame, options, true)
}

function showScreenshot(frame, { dialog, showDialog, isCurrent, upload }, initiallyPreview = false) {
  if (!isCurrent()) return
  showDialog(initiallyPreview ? '图片预览' : '框选截图', `<div class="screen-capture">
    <p data-capture-hint>在画面上拖动，框选要提交的区域，也可以使用整张截图。</p>
    <div class="capture-stage"><div class="capture-surface">
      <canvas data-capture-canvas aria-label="截图画面，拖动可框选区域"></canvas>
      <div class="capture-selection" data-capture-selection hidden></div>
    </div></div>
    <p class="subtle" data-capture-dimensions role="status"></p>
    <div class="form-error" role="alert" data-capture-error hidden></div>
    <div class="submit-row capture-actions" data-capture-crop>
      ${captureButton('full', '使用整张')}
      <button type="button" class="btn primary" data-capture-action="preview" disabled>预览截图</button>
    </div>
    <div class="submit-row capture-actions" data-capture-preview hidden>
      ${captureButton('back', '重新框选')}
      ${captureButton('upload', '确认上传', 'btn primary')}
    </div>
  </div>`, true)
  dialog.classList.add('dialog-capture')
  const root = dialog.querySelector('.screen-capture')
  const canvas = root.querySelector('[data-capture-canvas]')
  const stage = root.querySelector('.capture-stage')
  const surface = root.querySelector('.capture-surface')
  const outline = root.querySelector('[data-capture-selection]')
  const dimensions = root.querySelector('[data-capture-dimensions]')
  const issue = root.querySelector('[data-capture-error]')
  const previewButton = root.querySelector('[data-capture-action="preview"]')
  const events = new AbortController()
  const { signal } = events
  let selection
  let anchor
  let result
  let busy = false

  function fit() {
    const scale = Math.min(1, (stage.clientWidth - 20) / canvas.width, innerHeight * 0.55 / canvas.height)
    canvas.style.width = Math.floor(canvas.width * scale) + 'px'
    canvas.style.height = Math.floor(canvas.height * scale) + 'px'
  }

  function describe() {
    const width = Math.max(1, Math.round((selection?.width ?? 1) * frame.width))
    const height = Math.max(1, Math.round((selection?.height ?? 1) * frame.height))
    dimensions.textContent = `${width} × ${height} 像素`
  }

  function drawFrame() {
    canvas.width = frame.width
    canvas.height = frame.height
    canvas.getContext('2d').drawImage(frame, 0, 0)
    fit()
    describe()
  }

  function drawSelection() {
    outline.hidden = !selection
    if (!selection) return
    outline.style.left = selection.left * 100 + '%'
    outline.style.top = selection.top * 100 + '%'
    outline.style.width = selection.width * 100 + '%'
    outline.style.height = selection.height * 100 + '%'
    previewButton.disabled = selection.width * frame.width < 3 || selection.height * frame.height < 3
    describe()
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }

  function select(event) {
    if (!anchor) return
    const current = point(event)
    selection = {
      left: Math.min(anchor.x, current.x), top: Math.min(anchor.y, current.y),
      width: Math.abs(current.x - anchor.x), height: Math.abs(current.y - anchor.y),
    }
    drawSelection()
  }

  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy || result) return
    event.preventDefault()
    issue.hidden = true
    anchor = point(event)
    surface.setPointerCapture(event.pointerId)
    select(event)
  }, { signal })
  surface.addEventListener('pointermove', select, { signal })
  surface.addEventListener('pointerup', event => {
    select(event)
    anchor = null
  }, { signal })
  surface.addEventListener('pointercancel', () => { anchor = null }, { signal })

  function preview() {
    const crop = selection ?? { left: 0, top: 0, width: 1, height: 1 }
    const left = Math.min(frame.width - 1, Math.round(crop.left * frame.width))
    const top = Math.min(frame.height - 1, Math.round(crop.top * frame.height))
    result = document.createElement('canvas')
    result.width = Math.max(1, Math.min(frame.width - left, Math.round(crop.width * frame.width)))
    result.height = Math.max(1, Math.min(frame.height - top, Math.round(crop.height * frame.height)))
    result.getContext('2d').drawImage(frame, left, top, result.width, result.height, 0, 0, result.width, result.height)
    canvas.width = result.width
    canvas.height = result.height
    canvas.getContext('2d').drawImage(result, 0, 0)
    outline.hidden = true
    fit()
    dimensions.textContent = `${result.width} × ${result.height} 像素`
    root.querySelector('[data-capture-hint]').textContent = '确认这张截图后上传，也可以返回重新框选。'
    root.querySelector('[data-capture-crop]').hidden = true
    root.querySelector('[data-capture-preview]').hidden = false
  }

  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-capture-action]')
    if (!button || busy) return
    const action = button.dataset.captureAction
    issue.hidden = true
    if (action === 'full') {
      selection = null
      preview()
    } else if (action === 'preview') preview()
    else if (action === 'back') {
      result = null
      selection = null
      previewButton.disabled = true
      root.querySelector('[data-capture-hint]').textContent = '在画面上拖动，框选要提交的区域，也可以使用整张截图。'
      root.querySelector('[data-capture-crop]').hidden = false
      root.querySelector('[data-capture-preview]').hidden = true
      drawFrame()
    } else if (action === 'upload') {
      busy = true
      root.querySelectorAll('button').forEach(control => { control.disabled = true })
      button.textContent = '正在上传…'
      try {
        const image = await new Promise(resolve => result.toBlob(resolve, 'image/png'))
        if (!image || image.size > 10 * 1024 * 1024) throw new Error('截图超过 10 MB，请返回后缩小框选范围。')
        if (!isCurrent()) throw new Error('页面或登录账号已切换，请重新截图。')
        await upload(new File([image], '截图-' + Date.now() + '.png', { type: 'image/png' }))
        if (dialog.contains(root)) dialog.close()
      } catch (error) {
        if (dialog.contains(root)) {
          issue.textContent = error.message
          issue.hidden = false
        }
      } finally {
        busy = false
        button.textContent = '确认上传'
        root.querySelectorAll('button').forEach(control => { control.disabled = false })
      }
    }
  }, { signal })
  window.addEventListener('resize', fit, { signal })
  dialog.addEventListener('close', () => { events.abort() }, { once: true, signal })
  drawFrame()
  if (initiallyPreview) preview()
}
