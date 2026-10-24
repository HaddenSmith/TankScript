import React, { useState, useEffect } from 'react';

const SCRAMBLE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>[]{}+-=*/#$%@';
const SCRAMBLES_PER_CHARACTER = 3;
const MIN_DURATION = 800;
const MAX_DURATION = 1800;
const MS_PER_CHARACTER = 24;

export function ScrambleText({ text, duration }) {
    const [displayText, setDisplayText] = useState(() => getScrambledText(text));
    const [currentIndex, setCurrentIndex] = useState(0);
    const [scrambleCount, setScrambleCount] = useState(0);
    
    const automaticDuration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, text.length * MS_PER_CHARACTER));
    const targetDuration = duration ?? automaticDuration;
    const scrambleCharacterCount = [...text].filter((char) => !isStaticCharacter(char)).length;
    const totalFrames = scrambleCharacterCount * SCRAMBLES_PER_CHARACTER;
    const frameDelay = totalFrames > 0 ? targetDuration / totalFrames : 0;

    // Reset the animation whenever the target text changes.
    useEffect(() => {
        setDisplayText(getScrambledText(text));
        setCurrentIndex(0);
        setScrambleCount(0);
    }, [text]);

    // Main animation loop.
    // Scramble the current character for a few frames, then lock it in
    // and advance to the next character.
    useEffect(() => {
        if (currentIndex >= text.length) {
            setDisplayText(text);
            return;
        }

        const timeoutId = setTimeout(() => {                        
            if (scrambleCount >= SCRAMBLES_PER_CHARACTER - 1 || isStaticCharacter(text[currentIndex])) {
                setDisplayText(getScrambledText(text, currentIndex + 1));
                setCurrentIndex(currentIndex + 1);
                setScrambleCount(0);
            } else {
                setDisplayText(getScrambledText(text, currentIndex));
                setScrambleCount(scrambleCount + 1);
            }
        }, frameDelay);
        
    // Cancel the pending frame if the effect reruns or the component unmounts.
    return () => clearTimeout(timeoutId);
    }, [currentIndex, scrambleCount, text, frameDelay]);

    return (<span className="scramble-text" aria-label={text}>
                <span className="scramble-text__target" aria-hidden="true">
                    {text}
                </span>

                <span className="scramble-text__animated" aria-hidden="true">
                    {displayText}
                </span>
            </span>
            );
}

// Build one animation frame.
// Completed characters stay correct while all unresolved
// letters and numbers receive new random characters.
function getScrambledText(targetText, currentIndex = 0) {
    let scrambledText = ''
    for (let i = 0; i < targetText.length; i++) {
        if (isStaticCharacter(targetText[i])) {
            scrambledText += targetText[i];
        } else if (i < currentIndex) {
            scrambledText += targetText[i];
        } else {
            const randomChar = SCRAMBLE_CHARACTERS.charAt(Math.floor(Math.random() * SCRAMBLE_CHARACTERS.length));
            scrambledText += randomChar;
        }
    }

    return scrambledText;
}

// Keep spaces and punctuation unchanged during the scramble.
function isStaticCharacter(char) {
    return !/[A-Za-z0-9]/.test(char);
}