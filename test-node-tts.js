const { EdgeTTS } = require('node-edge-tts')

try {
    console.log('Testing node-edge-tts...');
    const tts = new EdgeTTS({
        voice: 'es-MX-DaliaNeural',
        lang: 'es-MX',
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });

    console.log('TTS Instance created.');
    console.log('Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(tts)));

    // Attempt synthesis
    tts.ttsPromise('Hola mundo', './test-audio.mp3')
        .then(() => console.log('Success!'))
        .catch(e => console.error('Error:', e));

} catch (e) {
    console.error('Instantiation Error:', e);
    console.log('Module dump:', require('node-edge-tts'));
}
