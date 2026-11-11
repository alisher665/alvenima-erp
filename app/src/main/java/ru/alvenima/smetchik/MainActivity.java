package ru.alvenima.smetchik;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
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

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_AUDIO_PERMISSION = 101;
    private WebView webView;
    private ServerSocket serverSocket;
    private ExecutorService serverExecutor;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);

        // Мост для вызова Java из JS
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

        // Метод для скачивания PDF
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

        // Метод для ОТПРАВКИ PDF файла (новый!)
        @JavascriptInterface
        public void sharePdf(String base64Image) {
            try {
                String base64Data = base64Image.substring(base64Image.indexOf(",") + 1);
                byte[] decodedBytes = Base64.decode(base64Data, Base64.DEFAULT);

                // Сохраняем во временную папку кэша
                File cachePath = new File(getCacheDir(), "Смета.pdf");
                try (FileOutputStream fos = new FileOutputStream(cachePath)) {
                    fos.write(decodedBytes);
                }

                // Получаем безопасный URI через FileProvider
                Uri contentUri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", cachePath);

                // Формируем Intent для отправки
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

    // ==========================================
    // ЛОКАЛЬНЫЙ СЕРВЕР (Без изменений)
    // ==========================================
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
            if (serverSocket != null) serverSocket.close();
            if (serverExecutor != null) serverExecutor.shutdown();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}