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
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
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
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_AUDIO_PERMISSION = 101;
    private Model model;
    private Recognizer recognizer;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private boolean isRecording = false;
    private String lastRecognizedText = "";

    private TextView statusText;
    private Button micButton;
    private EditText workNameInput, workQtyInput, workPriceInput;
    private TextView estimateList;
    private List<String> estimateItems = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scrollView = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(50, 50, 50, 50);
        scrollView.addView(layout);

        statusText = new TextView(this);
        statusText.setText("Загрузка модели Vosk...");
        statusText.setTextSize(18);
        layout.addView(statusText);

        micButton = new Button(this);
        micButton.setText("🎤 НАЖМИ И ГОВОРИ");
        micButton.setEnabled(false);
        micButton.setOnClickListener(v -> {
            if (!isRecording) {
                startVosk();
                micButton.setText("🛑 ОСТАНОВИТЬ");
                statusText.setText("Слушаю...");
            } else {
                stopVosk();
                micButton.setText("🎤 НАЖМИ И ГОВОРИ");
                statusText.setText("Обработка...");
            }
        });
        layout.addView(micButton);

        layout.addView(new TextView(this)); // отступ

        TextView labelName = new TextView(this);
        labelName.setText("Название работы:");
        layout.addView(labelName);

        workNameInput = new EditText(this);
        workNameInput.setHint("Например: Штукатурка стен");
        layout.addView(workNameInput);

        TextView labelQty = new TextView(this);
        labelQty.setText("Количество:");
        layout.addView(labelQty);

        workQtyInput = new EditText(this);
        workQtyInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        workQtyInput.setHint("0");
        layout.addView(workQtyInput);

        TextView labelPrice = new TextView(this);
        labelPrice.setText("Цена за единицу (₽):");
        layout.addView(labelPrice);

        workPriceInput = new EditText(this);
        workPriceInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        workPriceInput.setHint("0");
        layout.addView(workPriceInput);

        Button addButton = new Button(this);
        addButton.setText("➕ ДОБАВИТЬ В СМЕТУ");
        addButton.setOnClickListener(v -> addToEstimate());
        layout.addView(addButton);

        layout.addView(new TextView(this)); // отступ

        TextView listTitle = new TextView(this);
        listTitle.setText("ТЕКУЩАЯ СМЕТА:");
        listTitle.setTextSize(18);
        layout.addView(listTitle);

        estimateList = new TextView(this);
        estimateList.setText("Смета пока пуста");
        layout.addView(estimateList);

        Button pdfButton = new Button(this);
        pdfButton.setText("📄 СКАЧАТЬ PDF");
        pdfButton.setOnClickListener(v -> generatePdf());
        layout.addView(pdfButton);

        setContentView(scrollView);

        StorageService.unpack(this, "vosk-model-small-ru-0.22", "model",
                (model) -> {
                    this.model = model;
                    runOnUiThread(() -> {
                        statusText.setText("Модель готова! Нажмите микрофон.");
                        micButton.setEnabled(true);
                    });
                },
                (exception) -> {
                    runOnUiThread(() -> statusText.setText("Ошибка загрузки модели: " + exception.getMessage()));
                });
    }

    private void startVosk() {
        if (model == null || isRecording) return;

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_AUDIO_PERMISSION);
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
                                runOnUiThread(() -> {
                                    statusText.setText("Вы сказали: " + cleanText);
                                    workNameInput.setText(cleanText); // Вставляем в поле названия
                                });
                            }
                        }
                    }
                }
            });
            recordingThread.start();

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void stopVosk() {
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
                }
                String toShow = lastRecognizedText.isEmpty() ? "Ничего не распознано" : lastRecognizedText;
                runOnUiThread(() -> {
                    statusText.setText("Вы сказали: " + toShow);
                    if (!lastRecognizedText.isEmpty()) {
                        workNameInput.setText(lastRecognizedText);
                    }
                });
                recognizer.close();
                recognizer = null;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void addToEstimate() {
        String name = workNameInput.getText().toString();
        String qtyStr = workQtyInput.getText().toString();
        String priceStr = workPriceInput.getText().toString();

        if (name.isEmpty() || qtyStr.isEmpty() || priceStr.isEmpty()) {
            Toast.makeText(this, "Заполните все поля!", Toast.LENGTH_SHORT).show();
            return;
        }

        double qty = Double.parseDouble(qtyStr);
        double price = Double.parseDouble(priceStr);
        double total = qty * price;

        String item = String.format(Locale.getDefault(), "%s — %.1f × %.0f = %.0f ₽", name, qty, price, total);
        estimateItems.add(item);

        StringBuilder sb = new StringBuilder();
        double grandTotal = 0;
        for (String s : estimateItems) {
            sb.append(s).append("\n");
            // Парсим сумму из строки
            String[] parts = s.split("= ");
            if (parts.length > 1) {
                String sumStr = parts[1].replace(" ₽", "");
                grandTotal += Double.parseDouble(sumStr);
            }
        }
        sb.append("\nИТОГО: ").append(String.format(Locale.getDefault(), "%.0f ₽", grandTotal));
        estimateList.setText(sb.toString());

        workNameInput.setText("");
        workQtyInput.setText("");
        workPriceInput.setText("");
    }

    private void generatePdf() {
        if (estimateItems.isEmpty()) {
            Toast.makeText(this, "Смета пуста!", Toast.LENGTH_SHORT).show();
            return;
        }

        StringBuilder sb = new StringBuilder();
        sb.append("СМЕТА НА РАБОТЫ\n\n");
        double grandTotal = 0;
        for (String s : estimateItems) {
            sb.append(s).append("\n");
            String[] parts = s.split("= ");
            if (parts.length > 1) {
                String sumStr = parts[1].replace(" ₽", "");
                grandTotal += Double.parseDouble(sumStr);
            }
        }
        sb.append("\nИТОГО: ").append(String.format(Locale.getDefault(), "%.0f ₽", grandTotal));

        // Сохраняем как текстовый файл (для теста)
        String fileName = "Смета_" + System.currentTimeMillis() + ".txt";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        os.write(sb.toString().getBytes());
                        Toast.makeText(this, "Файл сохранен в Загрузки!", Toast.LENGTH_LONG).show();
                    }
                }
            } else {
                File file = new File(getExternalFilesDir(null), fileName);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(sb.toString().getBytes());
                    Toast.makeText(this, "Файл сохранен: " + file.getAbsolutePath(), Toast.LENGTH_LONG).show();
                }
            }
        } catch (Exception e) {
            Toast.makeText(this, "Ошибка: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> statusText.setText("Микрофон разрешен! Нажмите кнопку еще раз."));
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        isRecording = false;
        if (audioRecord != null) {
            audioRecord.stop();
            audioRecord.release();
        }
        if (recognizer != null) recognizer.close();
    }
}