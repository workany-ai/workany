export default {
  inputPlaceholder: 'Type anything...',
  reply: 'Reply...',
  welcomeTitle: 'What can I do for you?',
  welcomeSubtitle: 'I can help you with coding, writing, analysis, and more.',
  addFilesOrPhotos: 'Add files or photos',
  modeAuto: 'Auto',
  modeChat: 'Chat',
  modeTask: 'Task',
  modeAutoDesc: 'Auto-detect intent',
  modeChatDesc: 'Quick conversation',
  modeTaskDesc: 'Full agent capabilities',
  modeLabel: 'Mode',
  examplePrompts: {
    categories: {
      organizeFiles: {
        label: 'Organize Files',
        placeholder: 'Describe how you want to organize your files',
        prompts: [
          "Strictly within my 'Downloads' folder, scan only top-level files added in the last 30 days (ignoring subfolders and .app bundles). Remove duplicates, and categorize the rest by type into new subfolders here.",
          "Find all video files on my computer larger than 500MB that haven't been opened in the last 6 months, and generate a checklist spreadsheet for me to review.",
          "Read the '~/Desktop/Project_Assets' folder and batch rename all images based on their creation dates, using the format YYYY-MM-DD ProjectName_###.",
        ],
      },
      generateDocs: {
        label: 'Generate Docs',
        placeholder: 'Describe the document you want to generate',
        prompts: [
          "Analyze the 'Project_Proposal' folder and generate a 3-slide presentation (.pptx) with a sophisticated, high-end consulting design. Focus on visual storytelling, clean typography, and a cohesive logical flow. Save the presentation to my Desktop.",
          "Find all PDF invoices in my 'May_Tax_Returns' folder, extract the billing date, company name, and total amount, and compile them into a formatted .xlsx summary.",
          "Summarize this week's meeting notes from the Syncs folder, generate action items by owner, and output a cleanly formatted executive summary in Word.",
        ],
      },
      automateTasks: {
        label: 'Automate Tasks',
        placeholder: 'Describe the task you want to automate',
        prompts: [
          'Write a Python web scraper to fetch the top 30 news titles from HackerNews, save the results to a CSV file, and run the script locally right now.',
          'Check the top 3 products of the week from producthunt.com, extract their names and taglines, and generate a sleek, 3:4 aspect ratio introductory poster, saving it to my desktop.',
          "Read the 'clients.csv' containing company names on my desktop. Write and run a script to automatically search the web for each company's official website and contact email, and update the local CSV file with this new data.",
        ],
      },
    },
  },
};
