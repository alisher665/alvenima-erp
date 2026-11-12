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
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
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

import org.json.JSONObject;
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
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_AUDIO_PERMISSION = 101;
    private static final int FILECHOOSER_RESULTCODE = 102; // Код для выбора фото
    private static final String TAG = "VoskDebug";

    private WebView webView;
    private ServerSocket serverSocket;
    private ExecutorService serverExecutor;

    private Model model;
    private Recognizer recognizer;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private boolean isRecording = false;
    private String lastRecognizedText = "";

    private TextToSpeech tts;
    private boolean isTtsReady = false;

    // Переменная для обработки выбора файла из HTML
    private ValueCallback<Uri[]> mFilePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int result = tts.setLanguage(new Locale("ru", "RU"));
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    Log.e(TAG, "Русский язык не поддерживается TTS");
                } else {
                    isTtsReady = true;

                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            runOnUiThread(() -> {
                                if (webView != null) {
                                    webView.evaluateJavascript("onTtsDone();", null);
                                }
                            });
                        }

                        @Override
                        public void onError(String utteranceId) {
                            runOnUiThread(() -> {
                                if (webView != null) {
                                    webView.evaluateJavascript("onTtsDone();", null);
                                }
                            });
                        }
                    });
                }
            }
        });

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

            // ОБРАБОТЧИК ВЫБОРА ФАЙЛА ИЗ HTML
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                intent.setType("image/*"); // Разрешаем выбирать только картинки

                try {
                    startActivityForResult(intent, FILECHOOSER_RESULTCODE);
                } catch (Exception e) {
                    mFilePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient());
        setContentView(webView);

        startLocalServer();
    }

    // ПОЛУЧАЕМ РЕЗУЛЬТАТ ВЫБОРА ФАЙЛА
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILECHOOSER_RESULTCODE) {
            if (mFilePathCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }

            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                }
            }

            mFilePathCallback.onReceiveValue(results);
            mFilePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    public class WebAppInterface {

        @JavascriptInterface
        public void speak(String text) {
            if (isTtsReady && tts != null) {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "TTS_ID");
            }
        }

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
                                String cleanText = extractTextFromJson(result);
                                if (!cleanText.isEmpty()) {
                                    lastRecognizedText = cleanText;
                                    sendTextToJS(cleanText);
                                }
                                runOnUiThread(() -> webView.evaluateJavascript("onVoskResult(" + JSONObject.quote(cleanText) + ")", null));
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
                    String cleanText = extractTextFromJson(finalResult);
                    if (!cleanText.isEmpty()) {
                        lastRecognizedText = cleanText;
                        sendTextToJS(cleanText);
                    }
                    String toSend = lastRecognizedText.isEmpty() ? "" : lastRecognizedText;
                    runOnUiThread(() -> webView.evaluateJavascript("onVoskResult(" + JSONObject.quote(toSend) + ")", null));
                    lastRecognizedText = "";
                    recognizer.close();
                    recognizer = null;
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        private String extractTextFromJson(String json) {
            try {
                int start = json.indexOf("\"text\"");
                if (start != -1) {
                    start = json.indexOf(":", start) + 1;
                    int end = json.lastIndexOf("}");
                    String textPart = json.substring(start, end).trim();
                    if (textPart.startsWith("\"")) textPart = textPart.substring(1);
                    if (textPart.endsWith("\"")) textPart = textPart.substring(0, textPart.length() - 1);
                    return textPart.trim();
                }
            } catch (Exception ignored) {}
            return "";
        }

        private void sendTextToJS(String text) {
            runOnUiThread(() -> {
                try {
                    String js = String.format("window.handleVoiceInput(%s);", JSONObject.quote(text));
                    webView.evaluateJavascript(js, null);
                } catch (Exception e) {
                    e.printStackTrace();
                }
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
            if (tts != null) {
                tts.stop();
                tts.shutdown();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}