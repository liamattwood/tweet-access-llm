import { config } from 'dotenv';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';
import Groq from 'groq-sdk';
import { Scraper, SearchMode } from 'agent-twitter-client';

config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

let twitterScraper = null;

const formatTweet = (tweet) => {
  const text = tweet.text.replace(/\n/g, ' ');
  const author = tweet.username || tweet.user?.username || 'Unknown';
  const date = new Date(tweet.created || tweet.createdAt || Date.now()).toLocaleDateString();
  return `@${author} (${date}): ${text}`;
};

async function initTwitterScraper() {
  const spinner = ora('Connecting to Twitter...').start();
  try {
    twitterScraper = new Scraper();
    await twitterScraper.login(
      process.env.TWITTER_USERNAME,
      process.env.TWITTER_PASSWORD,
      process.env.TWITTER_EMAIL
    );
    spinner.succeed('Connected to Twitter');
    return true;
  } catch (error) {
    spinner.fail(`Failed to connect to Twitter: ${error.message}`);
    console.error(chalk.red('Error details:'), error);
    return false;
  }
}

async function generateSearchQueries(question) {
  const spinner = ora('Generating search queries...').start();
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are an expert at creating Twitter search queries. Your task is to take a user question and convert it into 2 search queries for Twitter/X.com that will find relevant tweets to help answer their question. Format your response as a numbered list with ONLY the 2 search queries (no explanation or other text).'
        },
        {
          role: 'user',
          content: `Create 2 search queries for Twitter to find information about: ${question}`
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 300,
    });

    const response = completion.choices[0].message.content.trim();
    
    const queries = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^\d+\./) || line.match(/^-/))
      .map(line => line.replace(/^\d+\.\s*|-\s*/, '').trim())
      .filter(query => query.length > 0);
    
    const searchQueries = queries.length > 0 ? queries.slice(0, 3) : [question];
    
    spinner.succeed(`Generated ${searchQueries.length} search queries`);
    searchQueries.forEach((query, index) => {
      console.log(chalk.cyan(`  Query ${index + 1}: ${query}`));
    });
    
    return searchQueries;
  } catch (error) {
    spinner.fail(`Failed to generate search queries: ${error.message}`);
    return [question];
  }
}

async function searchTweets(query) {
  const spinner = ora(`Searching Twitter for: ${chalk.cyan(query)}`).start();
  try {
    const tweets = [];
    const searchResults = twitterScraper.searchTweets(query, 20, SearchMode.Latest);
    
    let count = 0;
    for await (const tweet of searchResults) {
      if (count >= 3) break;
      if (tweet.text && tweet.text.length > 20 && !tweet.text.startsWith('RT @')) {
        tweets.push(tweet);
        count++;
      }
    }
    
    spinner.succeed(`Found ${chalk.green(tweets.length)} relevant tweets for this query`);
    return tweets;
  } catch (error) {
    spinner.fail(`Failed to search tweets: ${error.message}`);
    console.error(chalk.red('Error details:'), error);
    return [];
  }
}

async function generateAnswer(question, tweets) {
  const spinner = ora('Generating answer based on tweets...').start();
  
  if (tweets.length === 0) {
    spinner.warn('No tweets found to answer the question');
    return 'I couldn\'t find any relevant tweets to answer your question.';
  }
  
  try {
    const tweetContext = tweets.map(formatTweet).join('\n\n');
    
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: ` First Think deeply for at least five minutes (or longer if needed) to find the best approach.

Document all of your raw thinking, evolving ideas, discarded options, doubts, and reasoning process inside <think> tags. This must be pure continuous text with no formatting, line breaks, or symbols — just unstructured internal dialogue.

Write as if talking to yourself, using "I" to explain your thoughts, decisions, changes of mind, and obstacles. Use "but" often to show trade-offs and why you rejected certain paths. Show how your understanding evolved and what assumptions you tested. This is a transparent, step-by-step log of how you reached your answer.

After the <thinking> section, give your final, fully considered, and detailed answer, directly addressing the question. You are a helpful AI assistant that answers questions based on recent Twitter data. 
The tweets provided were collected using multiple search queries to ensure diverse perspectives.
Use only the provided tweets as your source of information. If the tweets don't contain sufficient information to answer the question fully, acknowledge the limitations. 
Always cite your sources using the Twitter username in your answer.
Synthesize information across all tweets to provide a comprehensive answer.`
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nHere are some recent tweets that might help answer this question:\n\n${tweetContext}`
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1000,
    });

    const answer = completion.choices[0].message.content;
    spinner.succeed('Answer generated');
    return answer;
  } catch (error) {
    spinner.fail(`Failed to generate answer: ${error.message}`);
    return `Error generating answer: ${error.message}`;
  }
}

async function processQuestion(question) {
  console.log(boxen(chalk.bold(`Question: ${question}`), {padding: 1, borderColor: 'blue'}));
  
  const startTime = performance.now();
  
  try {
    const queryStartTime = performance.now();
    const searchQueries = await generateSearchQueries(question);
    const queryEndTime = performance.now();
    const queryTimeSeconds = ((queryEndTime - queryStartTime) / 1000).toFixed(2);
    console.log(chalk.gray(`Query generation took ${queryTimeSeconds} seconds`));
    
    const searchStartTime = performance.now();
    const allTweets = [];
    for (let i = 0; i < searchQueries.length; i++) {
      const query = searchQueries[i];
      console.log(chalk.yellow(`\nSearching with Query ${i+1}: ${chalk.cyan(query)}`));
      
      const tweets = await searchTweets(query);
      if (tweets.length > 0) {
        console.log(chalk.green(`  Found ${tweets.length} tweets`));
        allTweets.push(...tweets);
      } else {
        console.log(chalk.yellow('  No relevant tweets found for this query'));
      }
    }
    
    const uniqueTweets = [...new Map(allTweets.map(tweet => [tweet.id, tweet])).values()];
    const searchEndTime = performance.now();
    const searchTimeSeconds = ((searchEndTime - searchStartTime) / 1000).toFixed(2);
    console.log(chalk.gray(`Tweet search took ${searchTimeSeconds} seconds`));
    
    if (uniqueTweets.length > 0) {
      console.log(chalk.yellow(`\nFound ${uniqueTweets.length} unique tweets across all queries:`));
      uniqueTweets.forEach((tweet, index) => {
        console.log(chalk.cyan(`\n[${index + 1}] `) + formatTweet(tweet));
      });
    } else {
      console.log(chalk.yellow('\nNo relevant tweets found across any queries.'));
    }
    
    const answerStartTime = performance.now();
    const answer = await generateAnswer(question, uniqueTweets);
    const answerEndTime = performance.now();
    const answerTimeSeconds = ((answerEndTime - answerStartTime) / 1000).toFixed(2);
    
    const endTime = performance.now();
    const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(boxen(
      chalk.green('\nAnswer:') + 
      '\n\n' + 
      answer + 
      '\n\n' + 
      chalk.gray(`Answer generation: ${answerTimeSeconds}s | Total time: ${totalTimeSeconds}s`), 
      {
        padding: 1,
        margin: { top: 1 },
        borderColor: 'green'
      }
    ));
  } catch (error) {
    const endTime = performance.now();
    const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
    
    console.error(chalk.red('\nError processing your question:'), error.message);
    console.log(chalk.yellow('Please try again with a different question.'));
    console.log(chalk.gray(`Failed after ${totalTimeSeconds} seconds`));
  }
}

async function startInteractiveMode() {
  console.log(boxen(chalk.bold.cyan('Groq Twitter Search'), {
    padding: 1,
    margin: 1,
    borderColor: 'cyan',
    textAlignment: 'center'
  }));
  
  console.log(chalk.yellow('Ask a question and I\'ll search Twitter to find an answer!\n'));
  
  const isTwitterReady = await initTwitterScraper();
  if (!isTwitterReady) {
    console.error(chalk.red('Please check your Twitter credentials in the .env file'));
    process.exit(1);
  }
  
  if (!process.env.GROQ_API_KEY) {
    console.error(chalk.red('GROQ_API_KEY is missing in the .env file'));
    process.exit(1);
  }

  const sessionStartTime = performance.now();
  let questionCount = 0;

  while (true) {
    const { question } = await inquirer.prompt([
      {
        type: 'input',
        name: 'question',
        message: 'What would you like to know? (type "exit" to quit)',
        validate: (input) => input.trim().length > 0 || 'Please enter a question'
      }
    ]);
    
    if (question.toLowerCase() === 'exit') {
      const sessionEndTime = performance.now();
      const sessionTimeMinutes = ((sessionEndTime - sessionStartTime) / 60000).toFixed(2);
      
      console.log(chalk.cyan('\n----- Session Summary -----'));
      console.log(chalk.cyan(`Questions answered: ${questionCount}`));
      console.log(chalk.cyan(`Total session time: ${sessionTimeMinutes} minutes`));
      console.log(chalk.cyan('Goodbye!'));
      process.exit(0);
    }
    
    await processQuestion(question);
    questionCount++;
    console.log('\n');
  }
}

const program = new Command();

program
  .name('groq-twitter-search')
  .description('Search Twitter and answer questions using Groq AI')
  .version('1.0.0');

program
  .command('ask')
  .description('Ask a one-time question')
  .argument('<question>', 'The question to answer')
  .action(async (question) => {
    const isTwitterReady = await initTwitterScraper();
    if (isTwitterReady) {
      await processQuestion(question);
    }
    process.exit(0);
  });

program
  .command('interactive')
  .description('Start interactive mode to ask multiple questions')
  .action(startInteractiveMode);

process.on('SIGINT', () => {
  console.log(chalk.yellow('\nGracefully shutting down...'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\nProcess terminated'));
  process.exit(0);
});

if (process.argv.length === 2) {
  startInteractiveMode();
} else {
  program.parse(process.argv);
}