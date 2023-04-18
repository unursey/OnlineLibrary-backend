/* eslint-disable no-console */
// импорт стандартных библиотек Node.js
const {existsSync, mkdirSync, readFileSync, writeFileSync, writeFile} = require('fs');
const {createServer} = require('http');

// файл для базы данных
const DB = process.env.DB || './db.json';
const DB_LABEL = process.env.DB_LABEL || './db_label.json';
// номер порта, на котором будет запущен сервер
const PORT = process.env.PORT || 3024;
// префикс URI для всех методов приложения
const URI = '/api/books';
const URI_LABEL = '/api/label';

/**
 * Класс ошибки, используется для отправки ответа с определённым кодом и описанием ошибки
 */
class ApiError extends Error {
  constructor(statusCode, data) {
    super();
    this.statusCode = statusCode;
    this.data = data;
  }
}

function drainJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(JSON.parse(data));
    });
  });
}


function isImage(data){
  return (/^data:image/).test(data);
}

function dataURLtoFile(base64, id) {
  if (!existsSync('./image')){
    mkdirSync('./image');
  }
  const format = base64.split(';')[0].split('/')[1];
  const ext = format === 'svg+xml' ? 'svg' : format === 'jpeg' ? 'jpg' : format;
  const base64Image = base64.split(';base64,').pop();
  writeFile(`./image/${id}.${ext}`, base64Image, {encoding: 'base64'}, (err) => {
    if (err) console.log(err);
  });
  return `image/${id}.${ext}`
}


function makeBooksFromData(data, id) {
  const errors = [];

  function asString(str) {
    return str && String(str).trim() || '';
  }

  function asLabel(str) {
    const labels = JSON.parse(readFileSync(DB_LABEL) || '[]');
    if (labels[str]) {
      return str;
    }
    return 'wish';
  }

  const book = {
    title: asString(data.title),
    author: asString(data.author),
    description: asString(data.description),
    label: asLabel(data.label),
    image: data.image,
    rating: data.rating || 0,
  };


  // проверяем, все ли данные корректные и заполняем объект ошибок, которые нужно отдать клиенту
  if (!book.title) errors.push({field: 'title', message: 'Не указано название книги'});
  if (!book.description) errors.push({field: 'description', message: 'Не указано описание'});

  // если есть ошибки, то бросаем объект ошибки с их списком и 422 статусом
  if (errors.length) throw new ApiError(422, {errors});

  if (isImage(book.image)) {
    const url = dataURLtoFile(book.image, id);
    book.image = url;
  } else {
    book.image = 'image/notimage.jpg';
  }

  return book;
}


function getLabelList() {
  return JSON.parse(readFileSync(DB_LABEL) || '[]');
}


/**
 * Возвращает список книг из базы данных
 */
function getBooksList(params = {}) {
  const books = JSON.parse(readFileSync(DB) || '[]');
  if (params.search) {
    const search = params.search.trim().toLowerCase();
    return books.filter(book => [
        book.title,
        book.description,
      ]
        .some(str => str.toLowerCase().includes(search))
    );
  }
  return books;
}


function getBooksLabelList(label) {
  if (!label) return getBooksList();
  const books = JSON.parse(readFileSync(DB) || '[]');
  if (!books) throw new ApiError(404, {message: 'Books Not Found'});
  return books.filter(book => book.label === label);
}


function createBook(data) {
  const id = Math.random().toString().substring(2, 8) + Date.now().toString().substring(7)
  const newBook = makeBooksFromData(data, id);
  newBook.id = id;
  writeFileSync(DB, JSON.stringify([...getBooksList(), newBook]), {encoding: 'utf8'});
  return newBook;
}

function getBooks(bookId) {
  const books = getBooksList().find(({id}) => id === bookId);
  if (!books) throw new ApiError(404, {message: 'Books Not Found'});
  return books;
}


function updateBooks(bookId, data) {
  const books = getBooksList();
  const bookIndex = books.findIndex(({id}) => id === bookId);
  if (bookIndex === -1) throw new ApiError(404, {message: 'Books Not Found'});
  Object.assign(books[bookIndex], makeBooksFromData({...books[bookIndex], ...data}, bookId));
  writeFileSync(DB, JSON.stringify(books), {encoding: 'utf8'});
  return books[bookIndex];
}

function deleteBook(bookId) {
  const books = getBooksList();
  const bookIndex = books.findIndex(({id}) => id === bookId);
  if (bookIndex === -1) throw new ApiError(404, {message: 'Book Not Found'});
  books.splice(bookIndex, 1);
  writeFileSync(DB, JSON.stringify(books), {encoding: 'utf8'});
  return {};
}


// создаём новый файл с базой данных, если он не существует
if (!existsSync(DB)) writeFileSync(DB, '[]', {encoding: 'utf8'});
if (!existsSync(DB_LABEL)) writeFileSync(DB_LABEL, '[]', {encoding: 'utf8'});

// создаём HTTP сервер, переданная функция будет реагировать на все запросы к нему
module.exports = createServer(async (req, res) => {
  // req - объект с информацией о запросе, res - объект для управления отправляемым ответом

  if  (req.url.substring(1, 6) === 'image') {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    require("fs").readFile(`.${req.url}`, (err, image) => {
      res.end(image);
    });
    return;
  }

  // этот заголовок ответа указывает, что тело ответа будет в JSON формате
  res.setHeader('Content-Type', 'application/json');

  // CORS заголовки ответа для поддержки кросс-доменных запросов из браузера
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');



  // запрос с методом OPTIONS может отправлять браузер автоматически для проверки CORS заголовков
  // в этом случае достаточно ответить с пустым телом и этими заголовками
  if (req.method === 'OPTIONS') {
    // end = закончить формировать ответ и отправить его клиенту
    res.end();
    return;
  }

  // если URI не начинается с нужного префикса - можем сразу отдать 404
  if (!req.url || (!req.url.startsWith(URI) && !req.url.startsWith(URI_LABEL))) {
    res.statusCode = 404;
    res.end(JSON.stringify({message: 'Not Found'}));
    return;
  }

  let data = null;
  // убираем из запроса префикс URI, разбиваем его на путь и параметры
  if (req.url.startsWith(URI_LABEL)) {
    data = [URI_LABEL];
  }
  if (req.url.startsWith(URI)) {
    data = req.url.substring(URI.length).split('?');
  }
  const [uri, query] = data;
  const queryParams = {};
  // параметры могут отсутствовать вообще или иметь вид a=b&b=c
  // во втором случае наполняем объект queryParams { a: 'b', b: 'c' }
  if (query) {
    for (const piece of query.split('&')) {
      const [key, value] = piece.split('=');
      queryParams[key] = value ? decodeURIComponent(value) : '';
    }
  }

  try {
    // обрабатываем запрос и формируем тело ответа
    const body = await (async () => {
      if (uri === URI_LABEL && req.method === 'GET') return getLabelList();
      if (/^\/category\/*/.test(uri)) {
        return getBooksLabelList(uri.replace(/^\/label\//, ''));
      }
      if (uri === '' || uri === '/') {
        if (req.method === 'GET') return getBooksList(queryParams);
        if (req.method === 'POST') {
          const createdBook = createBook(await drainJson(req));
          res.statusCode = 201;
          res.setHeader('Access-Control-Expose-Headers', 'Location');
          res.setHeader('Location', `${URI}/${createdBook.id}`);
          return createdBook;
        }
      } else {
        const itemId = uri.substring(1);
        if (req.method === 'GET') return getBooks(itemId);
        if (req.method === 'DELETE') return deleteBook(itemId);
        if (req.method === 'PATCH') return updateBooks(itemId, await drainJson(req));
      }
      return null;
    })();
    res.end(JSON.stringify(body));
  } catch (err) {
    // обрабатываем сгенерированную нами же ошибку
    if (err instanceof ApiError) {
      res.writeHead(err.statusCode);
      res.end(JSON.stringify(err.data));
    } else {
      // если что-то пошло не так - пишем об этом в консоль и возвращаем 500 ошибку сервера
      res.statusCode = 500;
      res.end(JSON.stringify({message: 'Server Error'}));
      console.error(err);
    }
  }
})
  // выводим инструкцию, как только сервер запустился...
  .on('listening', () => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`Сервер CRM запущен. Вы можете использовать его по адресу http://localhost:${PORT}`);
      console.log('Нажмите CTRL+C, чтобы остановить сервер');
      console.log('Доступные методы:');
      console.log(`GET ${URI} - получить список книг, в query параметр search можно передать поисковый запрос`);
      console.log(`POST ${URI} - создать объект книги, в теле запроса нужно передать объект {title: string, description: string, images?: base64, label: string }`);
      console.log(`GET ${URI}/{id} - получить книгу по ID`);
      console.log(`DELETE ${URI}/{id} - удалить книгу по ID`);
      console.log(`GET /api/label - получить список лейблов`);
    }
  })
  // ...и вызываем запуск сервера на указанном порту
  .listen(PORT);
