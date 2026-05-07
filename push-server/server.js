const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error(
    'Missing FIREBASE_SERVICE_ACCOUNT. Set it to your Firebase service account JSON before running npm start.',
  );
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'attendance-push-server' });
});

app.post('/send-attendance-push', async (req, res) => {
  const { attendanceId, deviceId, token, employeeId, checkin } = req.body || {};

  try {
    console.log('send-attendance-push request body:', JSON.stringify(req.body));

    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const message = {
      token,
      notification: {
        title: 'Attendance Check',
        body: 'Tap to mark your attendance',
      },
      data: {
        action: 'SEND_LOCATION',
        attendanceId: attendanceId || '',
        deviceId: deviceId || '',
        employeeId: String(employeeId || ''),
        checkin: String(checkin || 'IN'),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'attendance',
          clickAction: 'FCM_PLUGIN_ACTIVITY',
        },
      },
    };

    const messageId = await admin.messaging().send(message);

    res.json({
      success: true,
      messageId,
    });
  } catch (error) {
    console.error('Failed to send push notification:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });

    if (isUnregisteredTokenError(error)) {
      try {
        await clearStaleDeviceToken({ deviceId, token, attendanceId, employeeId });
      } catch (cleanupError) {
        console.error('Failed to clear stale push token:', {
          message: cleanupError?.message,
          stack: cleanupError?.stack,
        });
      }

      return res.status(410).json({
        success: false,
        error: 'Push token is no longer registered. Open the mobile app to register a fresh token.',
        details: error?.code,
        deviceId: deviceId || undefined,
      });
    }

    res.status(500).json({
      error: error?.message || 'Unknown error',
      details: error?.code || undefined,
    });
  }
});

function isUnregisteredTokenError(error) {
  return error?.code === 'messaging/registration-token-not-registered';
}

async function clearStaleDeviceToken({ deviceId, token, attendanceId, employeeId }) {
  const firestore = admin.firestore();

  if (deviceId && token) {
    const deviceRef = firestore.doc(`devices/${deviceId}`);
    const deviceSnapshot = await deviceRef.get();

    if (deviceSnapshot.exists && deviceSnapshot.data()?.token === token) {
      await deviceRef.set(
        {
          token: admin.firestore.FieldValue.delete(),
          tokenInvalidatedAt: Date.now(),
          tokenInvalidationReason: 'registration-token-not-registered',
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }
  }

  if (attendanceId) {
    await firestore.doc(`attendance/${attendanceId}`).set(
      withoutUndefined({
        pushStatus: 'Failed',
        verificationStatus: 'PushFailed',
        pushError: 'FCM registration token is no longer registered.',
        pushFailedAt: Date.now(),
        deviceId: deviceId || undefined,
        employeeId: normalizeEmployeeId(employeeId),
      }),
      { merge: true },
    );
  }
}

function normalizeEmployeeId(employeeId) {
  const parsedEmployeeId = Number(employeeId);
  return Number.isFinite(parsedEmployeeId) ? parsedEmployeeId : undefined;
}

function withoutUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Push server running on port ${port}`);
});
