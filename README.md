# LLM Twitter Search

A command-line tool that uses Groq AI and Twitter to answer questions by searching and analysing recent tweets.

Originally written around the end of 2024

## Features

- Search Twitter using AI-generated queries
- Analyse tweets using Groq's hosted LLMs
- Interactive mode for multiple questions
- One-time question mode
- Beautiful CLI interface with progress indicators
- Automatic tweet deduplication
- Performance timing for each step

## Prerequisites

- Node.js (v14 or higher)
- Twitter account credentials
- Groq API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/liamattwood/tweet-access-llm
cd tweet-access-llm
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your credentials:
```
TWITTER_USERNAME=your_username
TWITTER_PASSWORD=your_password
TWITTER_EMAIL=your_email
GROQ_API_KEY=your_groq_api_key
```

## Usage

### Interactive Mode
```bash
node index.js
```
This will start an interactive session where you can ask multiple questions.

### One-time Question
```bash
node index.js ask "Your question here"
```

## Example

```bash
$ node index.js ask "What are people saying about AI regulation?"
```

## Dependencies

- dotenv: Environment variable management
- commander: Command-line interface
- inquirer: Interactive prompts
- ora: Loading spinners
- chalk: Terminal styling
- boxen: Box drawing
- groq-sdk: Groq AI API
- agent-twitter-client: Twitter scraping

## License

MIT 