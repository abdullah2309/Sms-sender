# SMS Sender via ADB

This project sends SMS messages using your Android phone connected over USB with ADB, based on a list from an Excel file.

## Requirements

- Node.js
- ADB installed and working
- USB Debugging enabled on your Android phone
- Excel file with `PhoneNumber` and `Message` columns

## How to Use

1. Connect your Android phone via USB and allow USB debugging.
2. Run:

```bash
npm install
npm start
```

Each SMS will be sent via your phone using ADB commands.

## File Structure

```
sms-sender/
├── data/
│   └── sms_list.xlsx       # Excel file with phone numbers and messages
├── src/
│   └── sendSms.js          # Node.js script to send SMS using ADB
├── package.json            # Node.js dependencies
└── README.md               # Instructions
```