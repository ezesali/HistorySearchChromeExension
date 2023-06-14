/*global chrome*/
import './App.css';
import { OutlinedInput, IconButton } from '@mui/material';
import { Button } from '@mui/material';
import { Divider } from '@mui/material';
import { Box, Card, List, ListItemButton, ListItemIcon, ListItemText, Typography, Avatar } from '@mui/material';
import React, { useEffect, useState } from 'react';
import * as cheerio from 'cheerio';
import { LRUCache } from 'lru-cache';
import CircularProgress from '@mui/material/CircularProgress';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff';

import { OpenAIApi, Configuration } from 'openai';

function App() {

	const [chromeHistory, setChromeHistory] = useState([]);
	const [inputKeyword, setInputKeyword] = useState('');
	const [loading, setLoading] = useState(false);
	const [cache, setCache] = useState(new LRUCache({ max: 10 }));
	const [filterSite, setFilterSite] = useState([]);
	const [resultHistory, setResultHistory] = useState([]);

	const configuration = new Configuration({
		apiKey: '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',
	});

	delete configuration.baseOptions.headers['User-Agent'];

	const openai = new OpenAIApi(configuration);


	useEffect(() => {

		// Get history
		chrome.history.search({ text: '', maxResults: 100 })
			.then((historyItems) => {
				setChromeHistory(historyItems);
			}
			)
			.catch(() => setChromeHistory([]));

	}, []);

	// Update history list
	useEffect(() => {
		if (filterSite.length > 0) {

			setResultHistory(filterSite);


		} else {

			setResultHistory(chromeHistory);

		}
	}, [filterSite, chromeHistory]);


	//Extract text from sites and save it to LRU Cache
	const extractText = (historyUrl) => {

		if (!cache.has(historyUrl)) {

			//Only fetch html if is not a google url
			if (!RegExp(/http(s?):\/\/(www.)?google.(com)\/*/).test(historyUrl)) {

				fetch(historyUrl, { keepalive: true }).then(response => response.text()).then(html => {
					const parser = new DOMParser();
					const doc = parser.parseFromString(html, 'text/html');

					const serializer = new XMLSerializer();
					const fullHtml = serializer.serializeToString(doc);

					const htmlCheerio = cheerio.load(fullHtml);
					const textTags = [];


					// Using Cheerio that is a tool to interact with the html code and filtering some tags
					htmlCheerio('body *').each((index, element) => {
						const tagName = element.name;
						if (tagName !== 'script' || tagName !== 'style') {

							const text = htmlCheerio(element).text().trim();

							if (text !== '') {
								if (!textTags.includes(text)) {
									textTags.push(text);
								}
							}

						}
					});

					var textContent = textTags.join('\n');

					// seting cache with the key as the URL and the value as the content
					cache.set(historyUrl, textContent);

				}).catch(error => {
					console.log('Error:', error);
					return error;
				});
			}
		}
	};


	// OpenAI integration
	async function openAiSearchKeywords(keyword) {

		console.log('KEYWWORD: ' + keyword);

		// Prompting to get a better results of keywords
		const prompt = `Quiero que actues como un SEO especializado en Keyword Research que habla solo español.

    Genera una lista de las top 50 palabras clave que mas entran en el topico de la keyword principal y mas relacionadas esten a esta. "Keyword Principal:${keyword}".
    
    Para generar la respuesta siga estas instrucciones:
    1. La respuesta es sin descripcion, solo la lista sin enumerar
    2. No necesariamente tiene que estar la keyword principal.
    3. Tiene que ser una sola palabra.
    4. Que no se repitan.`;

		let options = {
			model: 'text-davinci-003',
			temperature: 0,
			max_tokens: 500,
			top_p: 1,
			frequency_penalty: 0.0,
			presence_penalty: 0.0,
			stop: ['/'],
		};

		let completeOptions = {
			...options,
			prompt: prompt,
		};

		const response = await openai.createCompletion(completeOptions);

		// Return keywords response
		return response.data.choices[0].text;

	}


	//Algorithm to search for keywords faster on a very large text
	const computeLPS = (keyword) => {
		const lps = [0];
		let length = 0;
		let i = 1;

		while (i < keyword.length) {
			if (keyword[i] === keyword[length]) {
				length++;
				lps[i] = length;
				i++;
			} else {
				if (length !== 0) {
					length = lps[length - 1];
				} else {
					lps[i] = 0;
					i++;
				}
			}
		}

		return lps;
	};

	// Calling the algorithm and returning the number of ocurrences of that keyword on the site text
	const searchKeyw = (keyword, text) => {
		const keywordLength = keyword.length;
		const textLength = text.length;

		const lps = computeLPS(keyword);

		let keywordIndex = 0;
		let textIndex = 0;
		const occurrences = [];

		while (textIndex < textLength) {
			if (keyword[keywordIndex] === text[textIndex]) {
				keywordIndex++;
				textIndex++;

				if (keywordIndex === keywordLength) {
					occurrences.push(textIndex - keywordIndex);
					keywordIndex = lps[keywordIndex - 1];
				}
			} else {
				if (keywordIndex !== 0) {
					keywordIndex = lps[keywordIndex - 1];
				} else {
					textIndex++;
				}
			}
		}

		return occurrences;
	};


	// Search what urls matches to the keywords
	const searchKeyword = () => {

		var countWords = 0;

		setResultHistory([]);

		const keywords = openAiSearchKeywords(inputKeyword);

		//Normalizing keywords avoiding diacritics and splitting them to an array
		keywords.then(keyw => {

			keyw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

			keyw.toLowerCase();

			console.log('KEYWORDS:', keyw);

			let listKeywords = keyw.split(', ');

			console.log('CONTADOR KEYWORDS: ', listKeywords.length);

			//Iterating the cache values
			cache.forEach((content, index) => {

				countWords = 0;

				//Normalizing site text avoiding diacritics and lowecasing them
				var contentWithoutDiacritics = content.normalize('NFD').replace(/[\u0300-\u036f]/g, '');


				contentWithoutDiacritics = contentWithoutDiacritics.toLowerCase();

				// Looping through the listKeywords and searching for that keywords in the content
				for (let i = 0; i < listKeywords.length; i++) {

					if (searchKeyw(listKeywords[i], contentWithoutDiacritics).length > 0) {

						console.log(`ENCONTRO ${listKeywords[i]} en la pagina: `, index);

						countWords = countWords + 1;
					}
				}

				console.log('CONTADOR DE PALABRAS ENCONTRADAS: ', countWords);

				console.log(`ENCONTRO el ${(countWords / listKeywords.length) * 100}% de las keywords en la pagina: `, index);


				// If there are mora than 5 keywords found it, we push it to the filtered list (This can be change)
				if (countWords > 5) {

					console.log(chromeHistory.find((site) => site.url === index)[0]);

					setFilterSite(filtSites => [...filtSites, chromeHistory.find((site) => site.url === index)]);

				}

				setLoading(false);

			});
		});

	};

	return (
		<div className="App">
			<h1 style={{ color: 'rgb(25, 118, 210)' }}>HISTORIAL DE BUSQUEDA</h1>
			<div>
				<OutlinedInput
					id="outlined-adornment-password"
					type='text'
					style={{ width: '80%' }}
					value={inputKeyword}
					onChange={(v) => setInputKeyword(v.target.value)}
					autoComplete='off'
					endAdornment={
						<IconButton
							onClick={() => { setResultHistory(chromeHistory); setFilterSite([]); setInputKeyword(''); }}
							edge="end">
							<FilterAltOffIcon />
						</IconButton>
					}
					placeholder="Escriba una palabra clave"
				/>
				<Button onClick={() => { setLoading(true); searchKeyword(); }} disabled={inputKeyword.trim() === ''} style={{ marginTop: 10, marginBottom: 20, width: '80%' }} variant="outlined">Buscar</Button>
			</div>
			<Divider light />
			<Card style={{ display: 'flex', justifyContent: 'space-around' }}>
				<Box>
					<Box style={{ overflowY: 'auto', maxHeight: '220px', display: 'flex', flexGrow: 1, flexDirection: 'column' }}>
						<List style={{ width: '100%', maxWidth: 420 }}>
							{loading ?
								<CircularProgress />
								:
								resultHistory.map((item, index) => {

									return (
										<ListItemButton onClick={() => window.open(item.url, '_blank')} onLoad={() => { extractText(item.url); }} key={index} className='itemHistory'>
											<ListItemIcon>
												<Avatar sx={{ width: 16, height: 16 }} src={`https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${item.url}&size=16`} alt={`Favicon of: ${item.url}`} />
											</ListItemIcon>
											<ListItemText
												primary={
													<Typography
														style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: 'calc(100% - 20px)' }}
														component="div"
														variant="body1"
													>
														{item.title}
													</Typography>
												}
												secondary={
													<Typography
														style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: 'calc(100% - 50px)' }}
														component="div"
														variant="body2"
													>
														{item.url}
													</Typography>
												}
											/>
										</ListItemButton>
									);
								}

								)
							}
						</List>
					</Box>
				</Box>
			</Card>
		</div>
	);
}

export default App;
