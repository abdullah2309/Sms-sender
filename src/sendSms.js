



const XLSX = require('xlsx');
const { spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, '../data/sms_list.xlsx');
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Get default SMS package name from the device settings.
const getDefaultSmsPackage = () => {
  try {
    const packageName = execSync('adb shell settings get secure sms_default_application')
      .toString()
      .trim();
    if (!packageName) {
      console.warn('⚠️ Default SMS app not found or not set. Using fallback: com.android.messaging');
      return 'com.android.messaging'; // Common fallback
    }
    return packageName;
  } catch (e) {
    console.error('❌ Failed to get default SMS app via ADB. Using fallback: com.android.messaging.', e.message);
    return 'com.android.messaging'; // Fallback for most devices
  }
};

const SMS_PACKAGE = getDefaultSmsPackage();
console.log(`📱 Using SMS package: ${SMS_PACKAGE}`);

// Function to send an ADB key event (e.g., ENTER, TAB) to the device.
// Includes a delay after the key event to allow UI to react.
const sendKeyEvent = (keyCode, delay = 500) => {
  console.log(`⌨️ Sending key event: ${keyCode}`);
  spawnSync('adb', ['shell', 'input', 'keyevent', keyCode.toString()], { stdio: 'inherit' });
  return wait(delay);
};

// Function to handle composed MMS sending (image + text).
// Pushes the image to the device and then uses an intent to open the MMS composer.
const sendMmsComposed = async (phone, imagePath, combinedText) => {
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Image not found at path: ${imagePath}. MMS cannot be sent.`);
    return false;
  }

  const devicePath = `/sdcard/Download/${path.basename(imagePath)}`;
  console.log(`📲 Pushing image ${imagePath} to device path ${devicePath}`);
  const pushResult = spawnSync('adb', ['push', imagePath, devicePath], { stdio: 'inherit' });

  if (pushResult.status !== 0) {
    console.error(`❌ Failed to push image ${imagePath} to device. MMS cannot be sent.`);
    return false;
  }
  console.log(`✅ Image pushed successfully to ${devicePath}`);

  // ADB intent arguments for sending an MMS with an image and optional text.
  const intentArgs = [
    'shell', 'am', 'start',
    '-a', 'android.intent.action.SEND', // Action for sending content
    '-t', 'image/*', // MIME type for image content
    '--eu', 'android.intent.extra.STREAM', `file://${devicePath}`, // URI of the image on the device
    '-e', 'address', phone, // Recipient's phone number
    '-n', `${SMS_PACKAGE}/.ui.ComposeMessageActivity`, // Target SMS/MMS composer activity
    '--ez', 'exit_on_sent', 'true' // Attempts to close the composer after sending
  ];

  // Add the combined text message to the intent if it's not empty.
  if (combinedText && combinedText.trim() !== "") {
    intentArgs.push('--es', 'android.intent.extra.TEXT', combinedText); // Standard extra for text content with ACTION_SEND
    // Note: Some messaging apps might alternatively expect 'sms_body' for the text part of an MMS.
    // If 'android.intent.extra.TEXT' doesn't work reliably, using '--es', 'sms_body', combinedText might be an alternative.
  }
  // '--ez', 'force_sms', 'true' was removed as this function is explicitly for MMS.

  console.log(`📸 Attempting to launch MMS intent for ${phone}. Image: ${imagePath}, Text: "${combinedText}"`);
  console.log(`Executing: adb ${intentArgs.join(' ')}`);
  const intentResult = spawnSync('adb', intentArgs, { stdio: 'inherit' });
  
  if (intentResult.status !== 0) {
    console.error(`❌ Failed to launch MMS intent for ${phone}.`);
    return false;
  }
  console.log(`✅ MMS intent launched for ${phone}.`);
  return true;
};

// The sendLocationAsSms function was removed as its functionality is now integrated
// into the main SMS sending logic, where location-only messages are formatted as text SMS.

(async () => {
  console.log('🚀 Starting SMS/MMS sending process...');
  for (const [index, row] of data.entries()) {
    console.log(`\n--------------------------------------------------`);
    console.log(`🔄 Processing row ${index + 1} of ${data.length}`);
    
    // Retrieve and sanitize data from the current Excel row
    const rawPhone = String(row.PhoneNumber || '');
    const phone = rawPhone.replace(/[^+\d]/g, '').trim(); // Keep '+' and digits
    const messageText = String(row.Message || '').trim();
    const imagePathInput = String(row.ImagePath || '').trim();
    const imagePath = imagePathInput ? path.resolve(imagePathInput) : null;
    const latitude = parseFloat(row.Latitude);
    const longitude = parseFloat(row.Longitude);

    console.log(`📋 Data from Excel: Phone (raw): "${rawPhone}", Message: "${messageText}", ImagePath: "${imagePathInput}", Latitude: ${row.Latitude}, Longitude: ${row.Longitude}`);
    console.log(`📞 Cleaned phone number: "${phone}"`);

    // Validate phone number
    if (!phone) {
      console.error(`❌ Invalid or missing phone number for row ${index + 1}. Skipping this row.`);
      continue;
    }

    // --- Content Preparation ---
    let locationString = ""; // Will hold the formatted location if available
    const hasMessage = messageText !== "";
    // Check if an image path was provided in the Excel sheet and if the file actually exists.
    // Log a warning if the specified image file is not found.
    if (imagePathInput && !fs.existsSync(imagePath)) {
      console.warn(`⚠️ Image specified in Excel ('${imagePathInput}', resolved to '${imagePath}') but not found on disk. This image will be ignored.`);
    }
    const hasImage = imagePath && fs.existsSync(imagePath); // True only if path provided and file exists
    const hasLocation = !isNaN(latitude) && !isNaN(longitude);
    
    if (hasLocation) {
      locationString = `https://maps.google.com/?q=${latitude},${longitude}`;
      console.log(`📍 Location data found: ${locationString}`);
    }

    // --- Message Sending Logic ---
    // Determine the type of message to send based on available content (image, text, location).

    if (hasImage) {
      // Scenario: Image is present. Send as MMS.
      // Text content for MMS will be a combination of original message and location string.
      let combinedTextForMms = "";
      if (hasMessage && locationString) {
        combinedTextForMms = `${messageText}\n${locationString}`; // Message + Location
      } else if (hasMessage) {
        combinedTextForMms = messageText; // Message only
      } else if (locationString) {
        combinedTextForMms = locationString; // Location only (as text part of MMS)
      } else {
        combinedTextForMms = ""; // Image only, no text (or a default like "Image attached" could be set here)
      }
      
      console.log(`✨ Preparing MMS for ${phone}. Content: Image: "${imagePath}"${combinedTextForMms ? `, Combined Text: "${combinedTextForMms}"` : ', No additional text.'}`);
      
      if (await sendMmsComposed(phone, imagePath, combinedTextForMms)) {
        console.log(`⏳ Waiting for MMS composer to load and attempting to send...`);
        await wait(5000); // Wait for MMS to compose (image loading can be slow)
        await sendKeyEvent(61); // Simulate TAB key: attempts to focus the send button. (Fragile, depends on app layout)
        await wait(1000);       // Additional wait after TAB, for UI to react.
        await sendKeyEvent(66); // Simulate ENTER key: attempts to press the send button.
        console.log(`✅ MMS successfully initiated for ${phone}.`);
      } else {
        console.error(`❌ Failed to send MMS to ${phone}. See previous errors for intent launch failure.`);
      }

    } else if (hasMessage || hasLocation) {
      // Scenario: No image, but message and/or location is present. Send as SMS.
      let finalSmsBody = "";
      if (hasMessage && locationString) {
        finalSmsBody = `${messageText}\nLocation: ${locationString}`; // Message + Location
        console.log(`📝 SMS type: Message with Location`);
      } else if (hasMessage) {
        finalSmsBody = messageText; // Message only
        console.log(`📝 SMS type: Text Message only`);
      } else if (locationString) {
        finalSmsBody = `Location: ${locationString}`; // Location only
        console.log(`📝 SMS type: Location only`);
      }
      // If only message is present, finalSmsBody is already messageText (covered by hasMessage).

      console.log(`💬 Preparing SMS for ${phone}. Content: Text: "${finalSmsBody}"`);
      const quotedMessage = `"${finalSmsBody.replace(/"/g, '\\"')}"`; // ADB shell requires quotes around the message body

      // ADB intent arguments for sending an SMS.
      const adbArgs = [
        'shell', 'am', 'start',
        '-a', 'android.intent.action.SENDTO', // Action for sending message to a specific recipient
        '-d', `smsto:${phone}`, // Recipient's phone number URI
        '--es', 'sms_body', quotedMessage, // The text message content
        '-n', `${SMS_PACKAGE}/.ui.ComposeMessageActivity`, // Target SMS composer activity
        '--ez', 'exit_on_sent', 'true' // Attempts to close the composer after sending
      ];
      
      console.log(`Executing SMS Intent: adb ${adbArgs.join(' ')}`);
      const result = spawnSync('adb', adbArgs, { stdio: 'inherit' });
      
      if (result.status === 0) {
        console.log(`✅ SMS intent launched for ${phone}.`);
        console.log(`⏳ Waiting for SMS composer to load and attempting to send...`);
        await wait(2000); // Wait for SMS to compose
        await sendKeyEvent(61); // Simulate TAB key: attempts to focus the send button. (Fragile)
        await sendKeyEvent(66); // Simulate ENTER key: attempts to press the send button.
        console.log(`✅ SMS successfully initiated for ${phone}.`);
      } else {
        console.error(`❌ Failed to launch SMS intent for ${phone}.`);
      }
    } else {
      // Scenario: No message, no image, and no location. Nothing to send.
      console.warn(`⚠️ No content (message, image, or location) to send for row ${index + 1} (Phone: ${phone}). Skipping.`);
      continue;
    }

    console.log(`⏱️ Waiting a bit before processing the next row...`);
    await wait(3000); // Wait before next operation to avoid overwhelming the device or network
  }
  console.log('\n--------------------------------------------------');
  console.log('🎉 All messages processed!');
})();