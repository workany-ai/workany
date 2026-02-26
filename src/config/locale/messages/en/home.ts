export default {
  inputPlaceholder: 'Describe a task...',
  reply: 'Reply...',
  welcomeTitle: 'What can I do for you?',
  welcomeSubtitle: 'I can help you with coding, writing, analysis, and more.',
  addFilesOrPhotos: 'Add files or photos',
  botInputPlaceholder: 'Ask Bot anything...',
  samplePrompts: 'Sample prompts',
  refreshPrompts: 'Refresh',

  allPrompts: [
    {
      title: 'Smart Organize Downloads',
      prompt:
        "Strictly within my 'Downloads' folder, scan only top-level files added in the last 30 days (ignoring subfolders and .app bundles). Remove duplicates, and categorize the rest by type into new subfolders here.",
    },
    {
      title: 'Audit Heavy Video Files',
      prompt:
        "Find all video files on my computer larger than 500MB that haven't been opened in the last 6 months, and generate a checklist spreadsheet for me to review.",
    },
    {
      title: 'Batch Rename Assets',
      prompt:
        "Read the '~/Desktop/Project_Assets' folder and batch rename all images based on their creation dates, using the format YYYY-MM-DD ProjectName_###.",
    },
    {
      title: 'Create Consulting Deck',
      prompt:
        "Analyze the 'Project_Proposal' folder and generate a 3-slide presentation (.pptx) with a sophisticated, high-end consulting design. Focus on visual storytelling, clean typography, and a cohesive logical flow. Save the presentation to my Desktop.",
    },
    {
      title: 'Extract Invoices to Excel',
      prompt:
        "Find all PDF invoices in my 'May_Tax_Returns' folder, extract the billing date, company name, and total amount, and compile them into a formatted .xlsx summary.",
    },
    {
      title: 'Meeting Notes to Word',
      prompt:
        'Summarize this week’s meeting notes from the Syncs folder, generate action items by owner, and output a cleanly formatted executive summary in Word.',
    },
    {
      title: 'Run Local Web Scraper',
      prompt:
        'Write a Python web scraper to fetch the top 30 news titles from HackerNews, save the results to a CSV file, and run the script locally right now.',
    },
    {
      title: 'Auto-design Product Posters',
      prompt:
        'Check the top 3 products of the week from producthunt.com, extract their names and taglines, and generate a sleek, 3:4 aspect ratio introductory poster, saving it to my desktop.',
    },
    {
      title: 'Auto-enrich Client CSV',
      prompt:
        "Read the 'clients.csv' containing company names on my desktop. Write and run a script to automatically search the web for each company's official website and contact email, and update the local CSV file with this new data.",
    },
  ],
};
