const fs = require('fs');

// Replace this with your private key from the JSON file
const rawKey = `PASTE_YOUR_PRIVATE_KEY_HERE`;

// Format the key
const formattedKey = rawKey
    .split('\n')
    .join('\\n');

console.log('Formatted key for .env file:');
console.log(`GOOGLE_PRIVATE_KEY="${formattedKey}"`); 