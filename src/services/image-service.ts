import axios from 'axios'
import path from 'path'
import fs from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'

class ImageService {
    private tempDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        // Ensure dir exists
        fs.mkdir(this.tempDir, { recursive: true }).catch(() => { })
    }

    async downloadImage(url: string): Promise<string> {
        try {
            const filename = `img_${uuidv4()}.jpg`
            const filepath = path.join(this.tempDir, filename)

            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer'
            })

            await fs.writeFile(filepath, response.data)
            return filepath
        } catch (error: any) {
            console.error('Image Download Failed:', error.message)
            throw error
        }
    }
}

export const imageService = new ImageService()
