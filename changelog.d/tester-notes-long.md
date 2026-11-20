# Very long tester sign-up text answers at once

### Fixed
- **A tester sign-up with very long text no longer holds up Home Assistant.** The check that keeps keys and tokens out of a sign-up took time that grew with the square of the text's length: 100,000 characters sent straight to Home Assistant (the panel stops at 500) held all of Home Assistant for about a minute. It now reads at most the first 1,000 characters of each box, more than any box takes; the answer is the same.
