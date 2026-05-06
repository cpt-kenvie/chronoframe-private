import { getPanoramaDecodeErrorDetails } from '~/libs/panorama/decode-error'

export const usePanoramaDecodeErrorMessage = () => {
  const { t } = useI18n({ useScope: 'global' })

  return (error: unknown): string | null => {
    const details = getPanoramaDecodeErrorDetails(error)
    if (!details.code) return null

    const compression = details.compression || t('dashboard.photos.table.cells.unknown')
    if (details.code === 'unsupported-exr-compression') {
      return t('dashboard.photos.errors.unsupportedExrCompression', {
        compression,
      })
    }

    return t('dashboard.photos.errors.panoramaDecodeFailed', {
      compression,
    })
  }
}
