from PIL import Image

# 640x360 black background
width = 640
height = 360
color = (0, 0, 0) # Black

img = Image.new('RGB', (width, height), color)
img.save('black_bg.png')
print("Image created: black_bg.png")
