import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

import java.awt.Color;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** 把使用手册 Markdown 转成 PDF（A4，中文思源黑体） */
public class PdfGen {

    static final float MARGIN = 48f;
    static final float WIDTH = PDRectangle.A4.getWidth() - MARGIN * 2;
    static final float PAGE_H = PDRectangle.A4.getHeight();

    static PDFont font;
    static float sizeBody = 10.5f;
    static float leading = 17f;

    public static void main(String[] args) throws Exception {
        File md = new File(args[0]);
        File out = new File(args[1]);
        File fontFile = new File(args[2]);

        List<String> lines = Files.readAllLines(md.toPath(), StandardCharsets.UTF_8);
        List<Block> blocks = parse(lines);

        try (PDDocument doc = new PDDocument()) {
            font = PDType0Font.load(doc, fontFile);
            Ctx ctx = new Ctx(doc);
            ctx.newPage();
            for (Block b : blocks) render(ctx, b);
            if (ctx.cs != null) ctx.cs.close();   // 关闭最后的绘制流，否则保存时报 open stream writer
            ctx.addFooters();
            doc.save(out);
        }
        System.out.println("PDF 已生成：" + out + "（" + (out.length() / 1024) + " KB）");
    }

    /* ---------------- 解析 Markdown ---------------- */
    static class Block {
        String type;        // h1 h2 h3 p ul li table
        int level;
        String text;
        List<String> items = new ArrayList<>();
        List<String> head = new ArrayList<>();
        List<List<String>> rows = new ArrayList<>();
    }

    static List<Block> parse(List<String> lines) {
        List<Block> out = new ArrayList<>();
        boolean inTable = false;
        Block table = null;
        for (String raw : lines) {
            String line = raw.replace("\r", "");
            String t = line.trim();
            if (t.isEmpty()) { inTable = false; continue; }
            if (t.startsWith("|")) {
                List<String> cells = splitRow(t);
                if (!inTable) {
                    table = new Block();
                    table.type = "table";
                    table.head = cells;
                    inTable = true;
                    out.add(table);
                } else if (t.replace("|", "").replace("-", "").replace(" ", "").isEmpty()) {
                    // 分隔行，跳过
                } else {
                    table.rows.add(cells);
                }
                continue;
            }
            inTable = false;
            if (t.startsWith("### ")) out.add(h(3, t.substring(4)));
            else if (t.startsWith("## ")) out.add(h(2, t.substring(3)));
            else if (t.startsWith("# ")) out.add(h(1, t.substring(2)));
            else if (t.startsWith("- ")) {
                Block b = new Block(); b.type = "ul"; b.text = t.substring(2); out.add(b);
            } else {
                Block b = new Block(); b.type = "p"; b.text = t; out.add(b);
            }
        }
        return out;
    }

    static Block h(int level, String text) {
        Block b = new Block(); b.type = "h" + level; b.level = level; b.text = text; return b;
    }

    static List<String> splitRow(String line) {
        String s = line.trim();
        if (s.startsWith("|")) s = s.substring(1);
        if (s.endsWith("|")) s = s.substring(0, s.length() - 1);
        List<String> cells = new ArrayList<>();
        for (String c : s.split("\\|")) cells.add(c.trim());
        return cells;
    }

    /* ---------------- 渲染 ---------------- */
    static class Ctx {
        PDDocument doc;
        PDPageContentStream cs;
        float y;
        int page = 0;
        List<PDPage> pages = new ArrayList<>();

        Ctx(PDDocument doc) { this.doc = doc; }

        void newPage() throws IOException {
            if (cs != null) cs.close();
            PDPage p = new PDPage(PDRectangle.A4);
            doc.addPage(p);
            pages.add(p);
            cs = new PDPageContentStream(doc, p);
            y = PAGE_H - MARGIN;
            page++;
        }

        boolean need(float h) throws IOException {
            if (y - h < MARGIN + 26) { newPage(); return true; }
            return false;
        }

        void text(String s, float x, float size, Color color, float lead) throws IOException {
            cs.beginText();
            cs.setFont(font, size);
            cs.setNonStrokingColor(color);
            cs.newLineAtOffset(x, y);
            cs.showText(sanitize(s));
            cs.endText();
            y -= lead;
        }

        void addFooters() throws IOException {
            for (int i = 0; i < pages.size(); i++) {
                try (PDPageContentStream f = new PDPageContentStream(doc, pages.get(i), PDPageContentStream.AppendMode.APPEND, true, true)) {
                    f.beginText();
                    f.setFont(font, 8.5f);
                    f.setNonStrokingColor(new Color(0x88, 0x8f, 0x99));
                    String label = "第 " + (i + 1) + " / " + pages.size() + " 页";
                    float w = font.getStringWidth(sanitize(label)) / 1000 * 8.5f;
                    f.newLineAtOffset((PDRectangle.A4.getWidth() - w) / 2, MARGIN - 16);
                    f.showText(label);
                    f.endText();
                }
            }
        }
    }

    static String sanitize(String s) {
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (c == '\t' || c == '\n' || c == '\r') sb.append(' ');
            else if (c < 0x20) continue;
            else sb.append(c);
        }
        return sb.toString();
    }

    static float width(String s, float size) throws IOException {
        return font.getStringWidth(sanitize(s)) / 1000 * size;
    }

    /** 按宽度折行（中文按字符，英文按词） */
    static List<String> wrap(String text, float maxW, float size) throws IOException {
        List<String> out = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        float w = 0;
        String[] tokens = text.split("(?<=\\s)|(?=[\\u4e00-\\u9fff（）【】《》、。，：；！？])");
        for (String tk : tokens) {
            if (tk.isEmpty()) continue;
            float tw = width(tk, size);
            if (w + tw > maxW && line.length() > 0) {
                out.add(line.toString().trim());
                line.setLength(0);
                w = 0;
            }
            line.append(tk);
            w += tw;
        }
        if (line.length() > 0) out.add(line.toString().trim());
        return out;
    }

    static void render(Ctx ctx, Block b) throws IOException {
        switch (b.type) {
            case "h1": {
                ctx.need(34 + 18);
                ctx.y -= 4;
                ctx.text(b.text, MARGIN, 19f, new Color(0x0F, 0x2B, 0x46), 24f);
                break;
            }
            case "h2": {
                ctx.need(16 + 26);
                ctx.y -= 8;
                ctx.text(b.text, MARGIN, 14f, new Color(0x0F, 0x2B, 0x46), 19f);
                break;
            }
            case "h3": {
                ctx.need(14 + 22);
                ctx.y -= 4;
                ctx.text(b.text, MARGIN, 12f, new Color(0x1B, 0x45, 0x70), 17f);
                break;
            }
            case "p": {
                for (String line : wrap(b.text, WIDTH, sizeBody)) {
                    ctx.need(leading);
                    ctx.text(line, MARGIN, sizeBody, new Color(0x22, 0x2B, 0x33), leading);
                }
                ctx.y -= 2;
                break;
            }
            case "ul": {
                float indent = 16f;
                List<String> ls = wrap(b.text, WIDTH - indent - 4, sizeBody);
                for (int i = 0; i < ls.size(); i++) {
                    ctx.need(leading);
                    String prefix = i == 0 ? "• " : "  ";
                    ctx.text(prefix + ls.get(i), MARGIN + 4, sizeBody, new Color(0x22, 0x2B, 0x33), i == ls.size() - 1 ? leading : leading);
                }
                break;
            }
            case "table": {
                renderTable(ctx, b);
                break;
            }
            default:
                break;
        }
    }

    static void renderTable(Ctx ctx, Block b) throws IOException {
        int cols = b.head.size();
        if (cols == 0) return;
        float fontSize = 9.5f;
        float cellPad = 5f;
        float colW = WIDTH / cols;

        // 计算每行格子的折行与高度
        List<List<List<String>>> wrapped = new ArrayList<>();
        for (List<String> row : b.rows) {
            List<List<String>> cells = new ArrayList<>();
            for (int i = 0; i < cols; i++) {
                String v = i < row.size() ? row.get(i) : "";
                cells.add(wrap(v, colW - cellPad * 2, fontSize));
            }
            wrapped.add(cells);
        }
        List<Float> heights = new ArrayList<>();
        for (List<List<String>> cells : wrapped) {
            int maxLines = 1;
            for (List<String> c : cells) maxLines = Math.max(maxLines, c.size());
            heights.add(maxLines * (fontSize + 4) + cellPad * 2);
        }
        float headH = (fontSize + 4) + cellPad * 2;

        // 表头
        ctx.need(headH + 6);
        float top = ctx.y;
        ctx.cs.setNonStrokingColor(new Color(0xEE, 0xF4, 0xFA));
        ctx.cs.addRect(MARGIN, top - headH, WIDTH, headH);
        ctx.cs.fill();
        ctx.y = top - cellPad - fontSize;
        for (int i = 0; i < cols; i++) {
            ctx.cs.beginText();
            ctx.cs.setFont(font, fontSize);
            ctx.cs.setNonStrokingColor(new Color(0x0F, 0x2B, 0x46));
            ctx.cs.newLineAtOffset(MARGIN + i * colW + cellPad, ctx.y);
            ctx.cs.showText(sanitize(String.join(" ", wrap(b.head.get(i), colW - cellPad * 2, fontSize))));
            ctx.cs.endText();
        }
        ctx.cs.setStrokingColor(new Color(0xCC, 0xD6, 0xE0));
        ctx.cs.setLineWidth(0.5f);
        ctx.cs.addRect(MARGIN, top - headH, WIDTH, headH);
        ctx.cs.stroke();
        ctx.y = top - headH;

        // 数据行
        for (int r = 0; r < wrapped.size(); r++) {
            float h = heights.get(r);
            if (ctx.y - h < MARGIN + 26) {
                ctx.newPage();
                ctx.y = PAGE_H - MARGIN;
                top = ctx.y;
            }
            float rowTop = ctx.y;
            List<List<String>> cells = wrapped.get(r);
            float ty = rowTop - cellPad - fontSize;
            for (int i = 0; i < cols; i++) {
                List<String> ls = cells.get(i);
                for (int k = 0; k < ls.size(); k++) {
                    ctx.cs.beginText();
                    ctx.cs.setFont(font, fontSize);
                    ctx.cs.setNonStrokingColor(new Color(0x22, 0x2B, 0x33));
                    ctx.cs.newLineAtOffset(MARGIN + i * colW + cellPad, ty - k * (fontSize + 4));
                    ctx.cs.showText(sanitize(ls.get(k)));
                    ctx.cs.endText();
                }
            }
            ctx.cs.setStrokingColor(new Color(0xCC, 0xD6, 0xE0));
            ctx.cs.addRect(MARGIN, rowTop - h, WIDTH, h);
            ctx.cs.stroke();
            ctx.y = rowTop - h;
        }
        ctx.y -= 8;
    }
}
