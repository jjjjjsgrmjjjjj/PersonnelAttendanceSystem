import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * 把示例 logo 转成 Android 各密度的图标 PNG。
 * 用法：java GenIcon <源图> <res目录>
 */
public class GenIcon {

    public static void main(String[] args) throws Exception {
        File src = new File(args[0]);
        File res = new File(args[1]);
        BufferedImage original = ImageIO.read(src);
        if (original == null) {
            throw new IllegalStateException("读不出图片：" + src);
        }

        String[][] launcher = {
                {"mipmap-mdpi", "48"},
                {"mipmap-hdpi", "72"},
                {"mipmap-xhdpi", "96"},
                {"mipmap-xxhdpi", "144"},
                {"mipmap-xxxhdpi", "192"},
        };
        for (String[] d : launcher) {
            write(res, d[0], "ic_launcher.png", original, Integer.parseInt(d[1]), 1.0);
        }

        // 自适应图标前景（108dp 画布，logo 只占中间安全区，留白给系统裁切）
        String[][] fg = {
                {"drawable-mdpi", "108"},
                {"drawable-hdpi", "162"},
                {"drawable-xhdpi", "216"},
                {"drawable-xxhdpi", "324"},
                {"drawable-xxxhdpi", "432"},
        };
        for (String[] d : fg) {
            write(res, d[0], "ic_launcher_foreground.png", original, Integer.parseInt(d[1]), 0.68);
        }
        System.out.println("图标已生成");
    }

    private static void write(File res, String dir, String name,
                              BufferedImage src, int size, double contentRatio) throws Exception {
        BufferedImage out = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, size, size);

        int inner = (int) Math.round(size * contentRatio);
        int x = (size - inner) / 2;
        int y = (size - inner) / 2;
        g.drawImage(src, x, y, inner, inner, null);
        g.dispose();

        File dirFile = new File(res, dir);
        dirFile.mkdirs();
        ImageIO.write(out, "png", new File(dirFile, name));
    }
}
