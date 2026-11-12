package ru.alvenima.smetchik;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_AUDIO_PERMISSION = 101;
    private WebView webView;
    private ServerSocket serverSocket;
    private ExecutorService serverExecutor;

    private Model model;
    private Recognizer recognizer;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private boolean isRecording = false;
    private String lastRecognizedText = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Инициализация Vosk
        StorageService.unpack(this, "vosk-model-small-ru-0.22", "model",
                (model) -> {
                    this.model = model;
                    runOnUiThread(() -> Toast.makeText(this, "Модель Vosk готова!", Toast.LENGTH_SHORT).show());
                    runOnUiThread(() -> webView.evaluateJavascript("onModelLoaded()", null));
                },
                (exception) -> {
                    runOnUiThread(() -> Toast.makeText(this, "Ошибка загрузки модели: " + exception.getMessage(), Toast.LENGTH_LONG).show());
                });

        webView = new WebView(this);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidApp");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_AUDIO_PERMISSION);
                        request.deny();
                    }
                });
            }
        });

        webView.setWebViewClient(new WebViewClient());
        setContentView(webView);

        startLocalServer();
    }

    // ==========================================
    // МОСТ МЕЖДУ JAVASCRIPT И JAVA
    // ==========================================
    public class WebAppInterface {

        @JavascriptInterface
        public void startVosk() {
            if (model == null) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Подождите, модель грузится...", Toast.LENGTH_SHORT).show());
                return;
            }
            if (isRecording) return;

            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_AUDIO_PERMISSION);
                return;
            }

            try {
                recognizer = new Recognizer(model, 16000.0f);
                lastRecognizedText = "";

                int bufferSize = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT) * 2;
                audioRecord = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize);

                if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) return;

                audioRecord.startRecording();
                isRecording = true;

                recordingThread = new Thread(() -> {
                    byte[] buffer = new byte[bufferSize];
                    while (isRecording) {
                        int bytesRead = audioRecord.read(buffer, 0, buffer.length);
                        if (bytesRead > 0) {
                            if (recognizer.acceptWaveForm(buffer, bytesRead)) {
                                String result = recognizer.getResult();
                                String cleanText = result.replaceAll(".*\"text\"\\s*:\\s*\"([^\"]*)\".*", "$1").replace("{", "").replace("}", "").trim();
                                if (!cleanText.isEmpty()) {
                                    lastRecognizedText = cleanText;
                                    parseAndFill(cleanText);
                                }
                                runOnUiThread(() -> webView.evaluateJavascript("onVoskResult('" + cleanText + "')", null));
                            }
                        }
                    }
                });
                recordingThread.start();

            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public void stopVosk() {
            if (!isRecording) return;
            isRecording = false;

            try {
                if (recordingThread != null) recordingThread.join();
                if (audioRecord != null) {
                    audioRecord.stop();
                    audioRecord.release();
                    audioRecord = null;
                }
                if (recognizer != null) {
                    String finalResult = recognizer.getFinalResult();
                    String cleanText = finalResult.replaceAll(".*\"text\"\\s*:\\s*\"([^\"]*)\".*", "$1").replace("{", "").replace("}", "").trim();
                    if (!cleanText.isEmpty()) {
                        lastRecognizedText = cleanText;
                        parseAndFill(cleanText);
                    }
                    String toSend = lastRecognizedText.isEmpty() ? "" : lastRecognizedText;
                    runOnUiThread(() -> webView.evaluateJavascript("onVoskResult('" + toSend + "')", null));
                    lastRecognizedText = "";
                    recognizer.close();
                    recognizer = null;
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        private void parseAndFill(String text) {
            String lowerText = text.toLowerCase().replace(",", ".");

            // Словарь чисел (можно расширить)
            Map<String, Integer> numberWords = new HashMap<>();
            numberWords.put("ноль", 0); numberWords.put("один", 1); numberWords.put("два", 2);
            numberWords.put("три", 3); numberWords.put("четыре", 4); numberWords.put("пять", 5);
            numberWords.put("шесть", 6); numberWords.put("семь", 7); numberWords.put("восемь", 8);
            numberWords.put("девять", 9); numberWords.put("десять", 10);
            numberWords.put("одиннадцать", 11); numberWords.put("двенадцать", 12);
            numberWords.put("тринадцать", 13); numberWords.put("четырнадцать", 14);
            numberWords.put("пятнадцать", 15); numberWords.put("шестнадцать", 16);
            numberWords.put("семнадцать", 17); numberWords.put("восемнадцать", 18);
            numberWords.put("девятнадцать", 19); numberWords.put("двадцать", 20);
            numberWords.put("тридцать", 30); numberWords.put("сорок", 40);
            numberWords.put("пятьдесят", 50); numberWords.put("шестьдесят", 60);
            numberWords.put("семьдесят", 70); numberWords.put("восемьдесят", 80);
            numberWords.put("девяносто", 90); numberWords.put("сто", 100);

            String name = lowerText;
            String qty = "";
            String unit = "м²";

            // Ищем цифры
            Pattern pattern = Pattern.compile("(\\d+(\\.\\d+)?)");
            Matcher matcher = pattern.matcher(lowerText);

            if (matcher.find()) {
                qty = matcher.group(1);
                name = lowerText.substring(0, matcher.start()).trim();
            } else {
                // Если цифр нет, ищем числа словами
                String[] words = lowerText.split("\\s+");
                int foundNumber = -1;
                int numberIndex = -1;

                for (int i = 0; i < words.length; i++) {
                    String word = words[i].replaceAll("[^а-я]", "");
                    if (numberWords.containsKey(word)) {
                        int val = numberWords.get(word);
                        // Проверяем следующее слово (например, "тридцать" и "пять" = 35)
                        if (i + 1 < words.length) {
                            String nextWord = words[i + 1].replaceAll("[^а-я]", "");
                            if (numberWords.containsKey(nextWord) && val >= 20 && numberWords.get(nextWord) < 10) {
                                val += numberWords.get(nextWord);
                                i++; // Пропускаем следующее слово
                            }
                        }
                        foundNumber = val;
                        numberIndex = i;
                        break;
                    }
                }

                if (foundNumber != -1) {
                    qty = String.valueOf(foundNumber);
                    // Отрезаем все слова до и включая число
                    name = lowerText.substring(0, lowerText.indexOf(words[numberIndex])).trim();
                }
            }

            name = name.replaceAll("(на|по|в|с|и|до)$", "").trim();

            if (lowerText.contains("квадрат") || lowerText.contains("кв м") || lowerText.contains("квадратный метр")) {
                unit = "м²";
            } else if (lowerText.contains("метр") || lowerText.contains("погонн")) {
                unit = "м.п.";
            } else if (lowerText.contains("штук") || lowerText.contains("шт")) {
                unit = "шт.";
            } else if (lowerText.contains("комплект")) {
                unit = "компл.";
            }

            final String finalName = name;
            final String finalQty = qty;
            final String finalUnit = unit;

            runOnUiThread(() -> {
                String js = String.format("onVoiceParsed('%s', '%s', '%s')", finalName, finalQty, finalUnit);
                webView.evaluateJavascript(js, null);
            });
        }

        @JavascriptInterface
        public void savePdf(String base64Image) {
            try {
                String base64Data = base64Image.substring(base64Image.indexOf(",") + 1);
                byte[] decodedBytes = Base64.decode(base64Data, Base64.DEFAULT);
                String fileName = "Смета_" + System.currentTimeMillis() + ".pdf";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream outputStream = getContentResolver().openOutputStream(uri)) {
                            outputStream.write(decodedBytes);
                            showToast("PDF сохранен в папку 'Загрузки'!");
                        }
                    }
                } else {
                    File file = new File(getExternalFilesDir(null), fileName);
                    try (FileOutputStream fos = new FileOutputStream(file)) {
                        fos.write(decodedBytes);
                        showToast("PDF сохранен: " + file.getAbsolutePath());
                    }
                }
            } catch (Exception e) {
                showToast("Ошибка при сохранении PDF: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void sharePdf(String base64Image) {
            try {
                String base64Data = base64Image.substring(base64Image.indexOf(",") + 1);
                byte[] decodedBytes = Base64.decode(base64Data, Base64.DEFAULT);

                File cachePath = new File(getCacheDir(), "Смета.pdf");
                try (FileOutputStream fos = new FileOutputStream(cachePath)) {
                    fos.write(decodedBytes);
                }

                Uri contentUri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", cachePath);

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                startActivity(Intent.createChooser(shareIntent, "Отправить смету"));
            } catch (Exception e) {
                showToast("Ошибка при отправке PDF: " + e.getMessage());
            }
        }
    }

    private void showToast(final String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
    }

    private void startLocalServer() {
        serverExecutor = Executors.newSingleThreadExecutor();
        serverExecutor.execute(() -> {
            try {
                serverSocket = new ServerSocket(8080, 0, InetAddress.getByName("127.0.0.1"));
                runOnUiThread(() -> webView.loadUrl("http://127.0.0.1:8080/index.html"));
                while (!serverSocket.isClosed()) {
                    Socket socket = serverSocket.accept();
                    handleRequest(socket);
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        });
    }

    private void handleRequest(Socket socket) {
        try {
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();
            byte[] buffer = new byte[2048];
            int bytesRead = input.read(buffer);
            if (bytesRead == -1) return;
            String request = new String(buffer, 0, bytesRead);

            String filePath = "index.html";
            if (request.startsWith("GET /")) {
                String[] parts = request.split(" ");
                if (parts.length > 1 && !parts[1].equals("/")) {
                    filePath = parts[1].substring(1);
                }
            }

            try {
                InputStream fileStream = getAssets().open(filePath);
                byte[] fileBytes = new byte[fileStream.available()];
                fileStream.read(fileBytes);
                fileStream.close();

                String mimeType = "text/html";
                if (filePath.endsWith(".js")) mimeType = "application/javascript";
                if (filePath.endsWith(".css")) mimeType = "text/css";

                String header = "HTTP/1.1 200 OK\r\nContent-Type: " + mimeType + "\r\nConnection: close\r\n\r\n";
                output.write(header.getBytes());
                output.write(fileBytes);
            } catch (IOException e) {
                output.write("HTTP/1.1 404 Not Found\r\n\r\n".getBytes());
            }
            output.flush();
            socket.close();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                showToast("Микрофон разрешен! Нажмите кнопку записи еще раз.");
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            isRecording = false;
            if (audioRecord != null) {
                audioRecord.stop();
                audioRecord.release();
            }
            if (recognizer != null) recognizer.close();
            if (serverSocket != null) serverSocket.close();
            if (serverExecutor != null) serverExecutor.shutdown();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}