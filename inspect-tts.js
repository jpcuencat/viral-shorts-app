const { EdgeTTS } = require('edge-tts-universal');

console.log('EdgeTTS Class:', EdgeTTS);
console.log('Prototype keys:', Object.getOwnPropertyNames(EdgeTTS.prototype));

try {
    const tts = new EdgeTTS({ voice: 'es-MX-DaliaNeural' });
    console.log('Synthesize toString:', tts.synthesize.toString());

    // Try calling with explicit string variable
    const text = "Hello world";
    console.log('Calling with:', text, typeof text);

    // Check if it expects 2 args
    const result = tts.synthesize(text, 'output.mp3');
    console.log('Result:', result);
} catch (e) {
    console.error('Error calling synthesize:', e);
}
