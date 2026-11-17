package ru.alvenima.smetchik;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.RingtoneManager;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
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
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.google.firebase.firestore.FirebaseFirestore;

import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_AUDIO_PERMISSION = 101;
    private static final int REQUEST_NOTIFICATION_PERMISSION = 103;
    private static final int FILECHOOSER_RESULTCODE = 102;
    private static final String TAG = "VoskDebug";

    private WebView webView;

    private Model model;
    private Recognizer recognizer;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private boolean isRecording = false;
    private String lastRecognizedText = "";

    private TextToSpeech tts;
    private boolean isTtsReady = false;

    private ValueCallback<Uri[]> mFilePathCallback;
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            NotificationChannel ch = new NotificationChannel(
                    "reminders", "Напоминания", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Напоминания приложения");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 400, 300, 400, 300, 400});

            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            ch.setSound(soundUri, attrs);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(ch);
            }
        }
    }


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannel(); // Создаём канал уведомлений со звуком

        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);




        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.BLACK);
        }

        String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);

        // --- НАЧАЛО БЛОКА ПРОВЕРКИ ЧЕРЕЗ FIRESTORE ---
        FirebaseFirestore db = FirebaseFirestore.getInstance();

        db.collection("users").document(androidId).get()
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        if (task.getResult().exists()) {
                            // Документ существует, доступ разрешен
                            initApp();
                        } else {
                            // Документа нет, доступ запрещен
                            showBlockScreen("Доступ запрещен.\n\nВаш ID:\n" + androidId + "\n\nОтправьте этот ID разработчику.");
                        }
                    } else {
                        // Ошибка сети или базы данных
                        showBlockScreen("Ошибка подключения к базе:\n" + task.getException().getMessage() + "\n\nВаш ID:\n" + androidId);
                    }
                });
        // --- КОНЕЦ БЛОКА ПРОВЕРКИ ---
    }

    private void showBlockScreen(String message) {
        TextView textView = new TextView(this);
        textView.setText(message);
        textView.setTextColor(Color.WHITE);
        textView.setTextSize(16);
        textView.setPadding(50, 50, 50, 50);
        textView.setBackgroundColor(Color.BLACK);
        setContentView(textView);
    }

    private void initApp() {
        // Запрос разрешения на уведомления (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATION_PERMISSION);
            }
        }

        // Инициализация TTS (Синтезатор речи)
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
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("onModelLoaded()", null);
                    });
                },
                (exception) -> {
                    runOnUiThread(() -> Toast.makeText(this, "Ошибка загрузки модели: " + exception.getMessage(), Toast.LENGTH_LONG).show());
                });

        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(true);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webSettings.setDatabaseEnabled(true);
        webView.clearCache(true);

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

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                intent.setType("image/*");

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
        webView.loadUrl("file:///android_asset/index.html");
    }

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
        public void createShortcut() {
            try {
                Intent shortcutIntent = new Intent(getApplicationContext(), MainActivity.class);
                shortcutIntent.setAction(Intent.ACTION_MAIN);

                Intent addIntent = new Intent();
                addIntent.putExtra(Intent.EXTRA_SHORTCUT_INTENT, shortcutIntent);
                addIntent.putExtra(Intent.EXTRA_SHORTCUT_NAME, "ALVENIMA");

                addIntent.putExtra(Intent.EXTRA_SHORTCUT_ICON_RESOURCE,
                        Intent.ShortcutIconResource.fromContext(getApplicationContext(), R.mipmap.ic_launcher));

                addIntent.setAction("com.android.launcher.action.INSTALL_SHORTCUT");
                getApplicationContext().sendBroadcast(addIntent);

                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Ярлык создан", Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Ошибка: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void saveBackupToDownloads(String jsonData, String fileName) {
            try {
                byte[] bytes = jsonData.getBytes("UTF-8");
                String savedPath = "";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) { notifyBackupResult(false, "Не удалось создать файл"); return; }
                    try (OutputStream outputStream = getContentResolver().openOutputStream(uri)) {
                        if (outputStream == null) { notifyBackupResult(false, "Поток пуст"); return; }
                        outputStream.write(bytes);
                        outputStream.flush();
                    }
                    savedPath = "Загрузки/" + fileName;
                } else {
                    File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!downloads.exists()) downloads.mkdirs();
                    File file = new File(downloads, fileName);
                    try (FileOutputStream fos = new FileOutputStream(file)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                    android.media.MediaScannerConnection.scanFile(
                            MainActivity.this, new String[]{file.getAbsolutePath()},
                            new String[]{"application/json"}, null);
                    savedPath = file.getAbsolutePath();
                }
                notifyBackupResult(true, savedPath);
            } catch (Exception e) {
                Log.e(TAG, "saveBackupToDownloads error", e);
                notifyBackupResult(false, e.getMessage());
            }
        }

        private void notifyBackupResult(boolean ok, String info) {
            final String msg = ok ? ("Бэкап сохранён: " + info) : ("Ошибка бэкапа: " + info);
            showToast(msg);
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "if (window.onBackupSaved) window.onBackupSaved(" + ok + ", " + JSONObject.quote(info) + ");",
                            null);
                }
            });
        }

        @JavascriptInterface
        public void setAlarm(long timestamp, String text) {
            AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            Intent intent = new Intent(MainActivity.this, AlarmReceiver.class);
            intent.putExtra("message", text);
            intent.putExtra("timestamp", timestamp);

            int requestCode = (int) (timestamp / 1000);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(MainActivity.this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            SharedPreferences prefs = getSharedPreferences("AlarmsData", Context.MODE_PRIVATE);
            prefs.edit().putString(String.valueOf(timestamp), text).apply();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (!alarmManager.canScheduleExactAlarms()) {
                    showToast("Разрешите точные будильники в настройках!");
                    Intent intentPerm = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                    startActivity(intentPerm);
                    return;
                }
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    AlarmManager.AlarmClockInfo info =
                            new AlarmManager.AlarmClockInfo(timestamp, null);
                    alarmManager.setAlarmClock(info, pendingIntent);
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, timestamp, pendingIntent);
                }
                showToast("Напоминание установлено!");
            } catch (SecurityException e) {
                showToast("Ошибка: нет разрешения на будильник");
            }

        }

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
                                runOnUiThread(() -> {
                                    if (webView != null) webView.evaluateJavascript("onVoskResult(" + JSONObject.quote(cleanText) + ")", null);
                                });
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
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("onVoskResult(" + JSONObject.quote(toSend) + ")", null);
                    });
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
                    if (webView != null) {
                        String js = String.format("window.handleVoiceInput(%s);", JSONObject.quote(text));
                        webView.evaluateJavascript(js, null);
                    }
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

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                showToast("Микрофон разрешен!");
                if (webView != null) webView.evaluateJavascript("if (window.AndroidApp && window.AndroidApp.startVosk) window.AndroidApp.startVosk();", null);
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
            if (tts != null) {
                tts.stop();
                tts.shutdown();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}