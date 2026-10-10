// Logos and stamps in templates exported from the original Feishu print plugin
// are hosted on that plugin's public OSS bucket. Keep those links so imported
// templates look like the original without re-uploading every image.
const ORIGINAL_TEMPLATE_IMAGE_PATTERN =
  /^https:\/\/lark-print\.oss-cn-[a-z0-9-]+\.aliyuncs\.com\/attachment\/[A-Za-z0-9/_-]+$/

export function isOriginalTemplateImageUrl(source: string | undefined | null): source is string {
  return Boolean(source && ORIGINAL_TEMPLATE_IMAGE_PATTERN.test(source.trim()))
}
