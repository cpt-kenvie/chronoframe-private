import type { Tags } from 'exiftool-vendored'

export interface NeededExif {
  Title?: string
  XPTitle?: string
  Subject?: string[]
  Keywords?: string[]
  XPKeywords?: string

  Description?: Tags['Description']
  ImageDescription?: Tags['ImageDescription']
  CaptionAbstract?: Tags['Caption-Abstract']
  XPComment?: Tags['XPComment']
  UserComment?: Tags['UserComment']

  zone?: string
  tz?: string
  tzSource?: string

  Orientation?: number
  Make?: string
  Model?: string
  Software?: string
  Artist?: string
  Copyright?: string

  ExposureTime?: string | number
  FNumber?: number
  ExposureProgram?: string
  ISO?: number
  ShutterSpeedValue?: string | number
  ApertureValue?: number
  BrightnessValue?: number
  ExposureCompensation?: number
  MaxApertureValue?: number

  OffsetTime?: string
  OffsetTimeOriginal?: string
  OffsetTimeDigitized?: string

  LightSource?: string
  Flash?: string

  FocalLength?: string
  FocalLengthIn35mmFormat?: string

  LensMake?: string
  LensModel?: string

  ColorSpace?: string

  ExposureMode?: string
  SceneCaptureType?: string

  Aperture?: number
  ScaleFactor35efl?: number
  ShutterSpeed?: string | number
  LightValue?: number

  DateTimeOriginal?: string
  DateTimeDigitized?: string

  ImageWidth?: number
  ImageHeight?: number

  MeteringMode?: Tags['MeteringMode']
  WhiteBalance?: Tags['WhiteBalance']
  WBShiftAB?: Tags['WBShiftAB']
  WBShiftGM?: Tags['WBShiftGM']
  WhiteBalanceBias?: Tags['WhiteBalanceBias']
  WhiteBalanceFineTune?: Tags['WhiteBalanceFineTune']
  FlashMeteringMode?: Tags['FlashMeteringMode']
  SensingMethod?: Tags['SensingMethod']
  FocalPlaneXResolution?: Tags['FocalPlaneXResolution']
  FocalPlaneYResolution?: Tags['FocalPlaneYResolution']
  GPSAltitude?: Tags['GPSAltitude']
  GPSLatitude?: Tags['GPSLatitude']
  GPSLongitude?: Tags['GPSLongitude']
  GPSAltitudeRef?: Tags['GPSAltitudeRef']
  GPSLatitudeRef?: Tags['GPSLatitudeRef']
  GPSLongitudeRef?: Tags['GPSLongitudeRef']

  // HDR Type
  MPImageType?: Tags['MPImageType']

  Rating?: number

  // Motion Photo (XMP) related fields
  MotionPhoto?: Tags['MotionPhoto']
  MotionPhotoVersion?: Tags['MotionPhotoVersion']
  MotionPhotoPresentationTimestampUs?: Tags['MotionPhotoPresentationTimestampUs']
  MicroVideo?: Tags['MicroVideo']
  MicroVideoVersion?: Tags['MicroVideoVersion']
  MicroVideoOffset?: Tags['MicroVideoOffset']
  MicroVideoPresentationTimestampUs?: Tags['MicroVideoPresentationTimestampUs']

  // Panorama (XMP-GPano) related fields
  GPanoUsePanoramaViewer?: boolean
  GPanoProjectionType?: string
  GPanoFullPanoWidthPixels?: number
  GPanoFullPanoHeightPixels?: number
  GPanoCroppedAreaImageWidthPixels?: number
  GPanoCroppedAreaImageHeightPixels?: number
  GPanoCroppedAreaLeftPixels?: number
  GPanoCroppedAreaTopPixels?: number
  PanoramaDetected?: boolean
  PanoramaConfidence?: number
  PanoramaDetectionMethod?: 'xmp' | 'ratio+seam' | 'ratio' | 'none'
  PanoramaSeamSimilarity?: number
}

export interface PhotoInfo {
  title: string
  dateTaken: string
  tags: string[]
  description: string
}
