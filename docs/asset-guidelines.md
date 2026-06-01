# Documentation Asset Guidelines

To keep the InsForge repository fast to clone, easy to maintain, and efficient for contributors, all documentation media assets should be reviewed and optimized before being committed.

## Asset Size Expectations

* Prefer optimized assets whenever possible.
* Files larger than **5 MB** should be reviewed carefully before being committed.
* Large media files increase repository clone size, slow documentation loading, and create unnecessary Git history churn.
* Consider whether an asset can be compressed or hosted externally before committing it to the repository.

## Video Assets

* Use MP4 for documentation videos whenever possible.
* Compress screen recordings before committing them.
* Verify that text, cursor movements, and UI interactions remain clearly visible after compression.
* Avoid committing duplicate versions of the same video.

### Compress MP4 Videos

Example command used for documentation video compression:

```bash
ffmpeg -i input.mp4 \
-vcodec libx264 \
-crf 28 \
-preset slow \
-an \
output.mp4
```

## Image Assets

### PNG Images

Compress PNG files before committing:

```bash
pngquant --force --ext .png image.png
```

### JPEG Images

Optimize JPEG files before committing:

```bash
jpegoptim image.jpg
```

### SVG Files

* Ensure SVG files contain vector data whenever possible.
* Avoid embedding large raster images as base64 content inside SVG files.
* Remove unnecessary metadata and optimize SVG exports before committing.

## External Hosting

Consider external hosting when:

* Media files are exceptionally large.
* The asset is primarily demonstrative and does not need version control.
* The same content can be referenced through a stable URL.

## Pull Request Checklist

Before submitting a pull request that includes documentation assets:

* [ ] Media files have been reviewed for size.
* [ ] Images have been optimized.
* [ ] Videos have been compressed where appropriate.
* [ ] Documentation references remain valid.
* [ ] No duplicate media assets have been committed.
* [ ] Large assets have a documented justification if optimization is not possible.

## Recommended Tools

* FFmpeg
* pngquant
* jpegoptim
* SVGO
