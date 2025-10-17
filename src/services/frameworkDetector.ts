/**
 * Framework detection service
 * Detects modern web frameworks and returns their static file directory
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Detect static file directory based on framework
 * Returns 'public' for supported frameworks, or null if not detected
 */
export function detectStaticFileDirectory(workspacePath: string): string | null {
    try {
        const packageJsonPath = path.join(workspacePath, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            return null;
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

        // Next.js - publicディレクトリ
        if (dependencies['next']) {
            return 'public';
        }

        // Astro - publicディレクトリ
        if (dependencies['astro']) {
            return 'public';
        }

        // Remix - publicディレクトリ
        if (dependencies['@remix-run/react'] || dependencies['remix']) {
            return 'public';
        }

        // Vite (一般的にはpublicディレクトリ)
        if (dependencies['vite']) {
            return 'public';
        }

        // Create React App - publicディレクトリ
        if (dependencies['react-scripts']) {
            return 'public';
        }

        return null;
    } catch (error) {
        console.error('Failed to detect framework:', error);
        return null;
    }
}
