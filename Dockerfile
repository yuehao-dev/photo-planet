FROM nginx:1.28-alpine
COPY deploy/nginx.demo.conf /etc/nginx/conf.d/default.conf
COPY index.html chat.html /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY config/site.js /usr/share/nginx/html/config/site.js
COPY data/ /usr/share/nginx/html/data/
COPY public/ /usr/share/nginx/html/public/
COPY demo-media/ /usr/share/nginx/html/demo-media/
COPY LICENSES/ /usr/share/nginx/html/LICENSES/
COPY LICENSE ASSETS.md /usr/share/nginx/html/
