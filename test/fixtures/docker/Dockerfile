FROM centos:latest
RUN useradd vmail
RUN usermod -a -G vmail vmail
RUN touch /var/log/maillog
RUN chown vmail:vmail /var/log/maillog
RUN chmod g+rw /var/log/maillog
RUN yum -y update
RUN yum -y install dovecot postfix
RUN usermod -a -G vmail postfix
COPY ./dovecot_conf.conf /etc/dovecot/dovecot.conf
COPY ./dovecot_passwd /etc/dovecot/passwd
COPY ./ssl.pem /etc/dovecot/ssl.pem
COPY ./postfix_main.cf /etc/postfix/main.cf
COPY ./postfix_master.cf /etc/postfix/master.cf
EXPOSE 2525
EXPOSE 143
EXPOSE 110
EXPOSE 993
EXPOSE 995
CMD /usr/sbin/postfix start; /usr/sbin/dovecot; sleep infinity
